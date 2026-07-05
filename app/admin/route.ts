import { Buffer } from "node:buffer";
import { createHash, createHmac, randomUUID } from "node:crypto";

type StoredIssue = {
  status?: string;
  reservedAt?: string;
  issuedAt?: string;
  customerIdentifier?: string;
  maskedIdentifier?: string;
  couponNumber?: string | null;
};

type AdminRow = StoredIssue & {
  key: string;
  ttlSeconds: number | null;
  isLegacyTtl: boolean;
};

type OperatorAccount = {
  id: string;
  username: string;
  passwordHash: string;
  merchantName: string;
  contactName: string;
  memo: string;
  createdAt: string;
};

type Session = {
  username: string;
  role: "admin" | "operator";
  merchantName?: string;
  exp: number;
};

type Device = {
  tid: string;
  installLocation: string;
  vendingModel: string;
  merchantName: string;
  status: string;
};

const SESSION_COOKIE = "ubcn_coupon_admin_session";
const POLICY_TTL_SECONDS = Number(process.env.ISSUED_COUPON_TTL_SECONDS ?? 86400);

const DEFAULT_DEVICES: Device[] = [
  {
    tid: "2000098745",
    installLocation: "테스트 설치 위치",
    vendingModel: "UBCn Vending",
    merchantName: "테스트 가맹사",
    status: "운영 준비",
  },
  {
    tid: "2000012345",
    installLocation: "본사 테스트존",
    vendingModel: "LVM-480",
    merchantName: "유비씨엔",
    status: "테스트",
  },
];

function getRedisConfig() {
  const url =
    process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL ?? "";
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ??
    process.env.KV_REST_API_TOKEN ??
    "";

  if (!url || !token) {
    return null;
  }

  return {
    url: url.replace(/\/$/, ""),
    token,
  };
}

async function runRedisCommand<T>(command: unknown[]): Promise<T> {
  const config = getRedisConfig();

  if (!config) {
    throw new Error("Redis is not configured.");
  }

  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Redis request failed.");
  }

  const data = (await response.json()) as { result: T };
  return data.result;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

function hashPassword(password: string) {
  return createHash("sha256")
    .update(`ubcn-coupon-admin:${password}`)
    .digest("hex");
}

function getAuthSecret() {
  return process.env.ADMIN_PASSWORD ?? "";
}

function sign(payload: string) {
  return createHmac("sha256", getAuthSecret()).update(payload).digest("base64url");
}

function createSessionCookie(session: Session) {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  const signature = sign(payload);

  return [
    `${SESSION_COOKIE}=${payload}.${signature}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=28800",
    process.env.NODE_ENV === "production" ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function getCookie(request: Request, name: string) {
  const cookie = request.headers.get("cookie") ?? "";
  const pairs = cookie.split(";").map((part) => part.trim());
  const pair = pairs.find((part) => part.startsWith(`${name}=`));

  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : null;
}

function readSession(request: Request): Session | null {
  const raw = getCookie(request, SESSION_COOKIE);

  if (!raw || !getAuthSecret()) {
    return null;
  }

  const [payload, signature] = raw.split(".");

  if (!payload || !signature || sign(payload) !== signature) {
    return null;
  }

  try {
    const session = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Session;

    if (!session.exp || session.exp < Date.now()) {
      return null;
    }

    return session;
  } catch {
    return null;
  }
}

function redirectTo(path: string, cookie?: string) {
  const headers = new Headers({ Location: path });

  if (cookie) {
    headers.append("Set-Cookie", cookie);
  }

  return new Response(null, { status: 303, headers });
}

function operatorKey(username: string) {
  return `coupon-admin-user:${normalizeUsername(username)}`;
}

async function getOperators(): Promise<OperatorAccount[]> {
  if (!getRedisConfig()) {
    return [];
  }

  const scanResult = await runRedisCommand<[string, string[]]>([
    "SCAN",
    "0",
    "MATCH",
    "coupon-admin-user:*",
    "COUNT",
    "100",
  ]);
  const keys = scanResult[1] ?? [];

  const rows = await Promise.all(
    keys.map(async (key) => {
      const rawValue = await runRedisCommand<string | null>(["GET", key]);
      return rawValue ? (JSON.parse(rawValue) as OperatorAccount) : null;
    }),
  );

  return rows
    .filter((row): row is OperatorAccount => Boolean(row))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function getOperator(username: string) {
  if (!getRedisConfig()) {
    return null;
  }

  const rawValue = await runRedisCommand<string | null>([
    "GET",
    operatorKey(username),
  ]);

  return rawValue ? (JSON.parse(rawValue) as OperatorAccount) : null;
}

async function createOperator(formData: FormData) {
  const username = normalizeUsername(String(formData.get("username") ?? ""));
  const password = String(formData.get("password") ?? "");
  const merchantName = String(formData.get("merchantName") ?? "").trim();
  const contactName = String(formData.get("contactName") ?? "").trim();
  const memo = String(formData.get("memo") ?? "").trim();

  if (!username || !password || !merchantName) {
    return false;
  }

  const account: OperatorAccount = {
    id: randomUUID(),
    username,
    passwordHash: hashPassword(password),
    merchantName,
    contactName,
    memo,
    createdAt: new Date().toISOString(),
  };

  await runRedisCommand(["SET", operatorKey(username), JSON.stringify(account)]);
  return true;
}

async function deleteOperator(formData: FormData) {
  const username = normalizeUsername(String(formData.get("username") ?? ""));

  if (!username) {
    return false;
  }

  await runRedisCommand(["DEL", operatorKey(username)]);
  return true;
}

function getDevices(): Device[] {
  const rawDevices = process.env.ADMIN_DEVICE_LIST_JSON;

  if (!rawDevices) {
    return DEFAULT_DEVICES;
  }

  try {
    const devices = JSON.parse(rawDevices) as Device[];
    return Array.isArray(devices) && devices.length > 0 ? devices : DEFAULT_DEVICES;
  } catch {
    return DEFAULT_DEVICES;
  }
}

function formatRemaining(ttlSeconds: number | null) {
  if (ttlSeconds === null || ttlSeconds < 0) {
    return "-";
  }

  const cappedSeconds = Math.min(ttlSeconds, POLICY_TTL_SECONDS || 86400);
  const hours = Math.floor(cappedSeconds / 3600);
  const minutes = Math.floor((cappedSeconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}시간 ${minutes}분`;
  }

  return `${minutes}분`;
}

function formatDateTime(value: string | undefined) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "Asia/Seoul",
  }).format(date);
}

async function getRows(): Promise<AdminRow[]> {
  const scanResult = await runRedisCommand<[string, string[]]>([
    "SCAN",
    "0",
    "MATCH",
    "coupon-issued:*",
    "COUNT",
    "100",
  ]);
  const keys = scanResult[1] ?? [];

  const rows = await Promise.all(
    keys.map(async (key) => {
      const [rawValue, ttlSeconds] = await Promise.all([
        runRedisCommand<string | null>(["GET", key]),
        runRedisCommand<number>(["TTL", key]),
      ]);
      const value = rawValue ? (JSON.parse(rawValue) as StoredIssue) : {};

      return {
        key,
        ttlSeconds,
        isLegacyTtl: typeof ttlSeconds === "number" && ttlSeconds > POLICY_TTL_SECONDS,
        ...value,
      };
    }),
  );

  return rows.sort((a, b) =>
    String(b.issuedAt ?? b.reservedAt ?? "").localeCompare(
      String(a.issuedAt ?? a.reservedAt ?? ""),
    ),
  );
}

async function cleanLegacyTtlRows(rows: AdminRow[]) {
  const legacyKeys = rows
    .filter((row) => row.ttlSeconds !== null && row.ttlSeconds > POLICY_TTL_SECONDS)
    .map((row) => row.key);

  await Promise.all(legacyKeys.map((key) => runRedisCommand(["DEL", key])));

  return legacyKeys.length;
}

function renderLogin(error: boolean) {
  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>쿠폰 발급 관리자 로그인</title>
    <style>
      * { box-sizing: border-box; }
      body {
        min-height: 100vh;
        margin: 0;
        display: grid;
        place-items: center;
        background: linear-gradient(135deg, #eef5ff 0%, #f8fafc 100%);
        color: #111827;
        font-family: Arial, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
      }
      .login-card {
        width: min(420px, calc(100vw - 32px));
        padding: 32px;
        border: 1px solid #dbe7f5;
        border-radius: 20px;
        background: #fff;
        box-shadow: 0 24px 60px rgba(15, 23, 42, 0.12);
      }
      h1 { margin: 0 0 8px; font-size: 26px; letter-spacing: -0.02em; }
      p { margin: 0 0 24px; color: #64748b; line-height: 1.55; }
      label { display: block; margin: 14px 0 7px; font-weight: 800; }
      input {
        width: 100%;
        height: 48px;
        padding: 0 14px;
        border: 1px solid #cbd5e1;
        border-radius: 10px;
        font-size: 15px;
      }
      button {
        width: 100%;
        height: 50px;
        margin-top: 22px;
        border: 0;
        border-radius: 10px;
        background: #0b63ce;
        color: #fff;
        font-size: 16px;
        font-weight: 900;
        cursor: pointer;
      }
      .error {
        margin-bottom: 16px;
        padding: 12px 14px;
        border-radius: 10px;
        background: #fff1f2;
        color: #be123c;
        font-weight: 800;
      }
      .hint {
        margin-top: 16px;
        padding: 12px 14px;
        border-radius: 10px;
        background: #f8fafc;
        color: #64748b;
        font-size: 13px;
      }
    </style>
  </head>
  <body>
    <form class="login-card" method="post" action="/admin">
      <input type="hidden" name="action" value="login" />
      <h1>쿠폰 관리자 로그인</h1>
      <p>관리자는 운영자 계정과 단말기 현황을 함께 확인할 수 있습니다.</p>
      ${error ? `<div class="error">아이디 또는 비밀번호를 확인해 주세요.</div>` : ""}
      <label for="username">아이디</label>
      <input id="username" name="username" autocomplete="username" placeholder="admin 또는 운영자 아이디" required />
      <label for="password">비밀번호</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required />
      <button type="submit">로그인</button>
      <div class="hint">관리자: 유비씨엔 직원용 / 운영자: 가맹사 확인용으로 구분됩니다.</div>
    </form>
  </body>
</html>`;
}

function renderOperatorRows(operators: OperatorAccount[]) {
  if (operators.length === 0) {
    return `<div class="empty">등록된 운영자 계정이 없습니다.</div>`;
  }

  return `<table>
    <thead>
      <tr>
        <th>아이디</th>
        <th>소속/가맹사</th>
        <th>담당자</th>
        <th>메모</th>
        <th>등록일</th>
        <th>관리</th>
      </tr>
    </thead>
    <tbody>
      ${operators
        .map(
          (operator) => `<tr>
            <td><strong>${escapeHtml(operator.username)}</strong></td>
            <td>${escapeHtml(operator.merchantName)}</td>
            <td>${escapeHtml(operator.contactName || "-")}</td>
            <td>${escapeHtml(operator.memo || "-")}</td>
            <td>${escapeHtml(formatDateTime(operator.createdAt))}</td>
            <td>
              <form method="post" action="/admin" onsubmit="return confirm('운영자 계정을 삭제할까요?');">
                <input type="hidden" name="action" value="deleteOperator" />
                <input type="hidden" name="username" value="${escapeHtml(operator.username)}" />
                <button class="ghost danger" type="submit">삭제</button>
              </form>
            </td>
          </tr>`,
        )
        .join("")}
    </tbody>
  </table>`;
}

function renderDeviceRows(devices: Device[]) {
  return `<table>
    <thead>
      <tr>
        <th>TID</th>
        <th>설치 위치</th>
        <th>자판기 모델</th>
        <th>가맹사/설치회사</th>
        <th>상태</th>
      </tr>
    </thead>
    <tbody>
      ${devices
        .map(
          (device) => `<tr>
            <td><span class="tid">TID: ${escapeHtml(device.tid)}</span></td>
            <td>${escapeHtml(device.installLocation)}</td>
            <td>${escapeHtml(device.vendingModel)}</td>
            <td>${escapeHtml(device.merchantName)}</td>
            <td><span class="status-pill">${escapeHtml(device.status)}</span></td>
          </tr>`,
        )
        .join("")}
    </tbody>
  </table>`;
}

function renderIssueRows(rows: AdminRow[]) {
  if (rows.length === 0) {
    return `<div class="empty">저장된 발급 기록이 없습니다.</div>`;
  }

  return `<table>
    <thead>
      <tr>
        <th>전화번호</th>
        <th>마스킹</th>
        <th>쿠폰번호</th>
        <th>상태</th>
        <th>발급/예약 시각</th>
        <th>남은 시간</th>
      </tr>
    </thead>
    <tbody>
      ${rows
        .map(
          (row) => `<tr class="${row.isLegacyTtl ? "legacy" : ""}">
            <td>${escapeHtml(row.customerIdentifier ?? row.maskedIdentifier ?? "-")}</td>
            <td>${escapeHtml(row.maskedIdentifier ?? "-")}</td>
            <td>${escapeHtml(row.couponNumber ?? "-")}</td>
            <td><span class="status-pill">${escapeHtml(row.status ?? "-")}</span></td>
            <td>${escapeHtml(formatDateTime(row.issuedAt ?? row.reservedAt))}</td>
            <td>
              ${escapeHtml(formatRemaining(row.ttlSeconds))}
              ${row.isLegacyTtl ? `<span class="warning">이전 테스트 기록</span>` : ""}
            </td>
          </tr>`,
        )
        .join("")}
    </tbody>
  </table>`;
}

function renderAdminPage({
  session,
  rows,
  operators,
  devices,
}: {
  session: Session;
  rows: AdminRow[];
  operators: OperatorAccount[];
  devices: Device[];
}) {
  const isAdmin = session.role === "admin";
  const legacyCount = rows.filter((row) => row.isLegacyTtl).length;
  const issuedCount = rows.filter((row) => row.status === "issued").length;
  const activeOperatorCount = operators.length;

  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>쿠폰 발급 관리자</title>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: #eef3f8;
        color: #111827;
        font-family: Arial, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
      }
      a { color: inherit; }
      .layout {
        display: grid;
        grid-template-columns: 250px 1fr;
        min-height: 100vh;
      }
      aside {
        padding: 24px 18px;
        background: #0b2d55;
        color: #dbeafe;
      }
      .brand {
        padding: 0 4px 24px;
        border-bottom: 1px solid rgba(255,255,255,0.14);
      }
      .brand strong {
        display: block;
        color: #fff;
        font-size: 22px;
        letter-spacing: -0.03em;
      }
      .brand span { display: block; margin-top: 6px; color: #93c5fd; font-weight: 800; }
      .profile {
        margin: 18px 0;
        padding: 14px;
        border: 1px solid rgba(255,255,255,0.14);
        border-radius: 14px;
        background: rgba(255,255,255,0.08);
      }
      .profile b { display: block; color: #fff; margin-bottom: 6px; }
      .role {
        display: inline-block;
        padding: 5px 9px;
        border-radius: 999px;
        background: ${isAdmin ? "#dbeafe" : "#dcfce7"};
        color: ${isAdmin ? "#1d4ed8" : "#15803d"};
        font-size: 12px;
        font-weight: 900;
      }
      nav a {
        display: block;
        margin-top: 8px;
        padding: 12px 14px;
        border-radius: 10px;
        color: #dbeafe;
        text-decoration: none;
        font-weight: 800;
      }
      nav a.active, nav a:hover { background: rgba(255,255,255,0.12); color: #fff; }
      .logout {
        width: 100%;
        margin-top: 18px;
        padding: 12px 14px;
        border: 1px solid rgba(255,255,255,0.24);
        border-radius: 10px;
        background: transparent;
        color: #fff;
        font-weight: 900;
        cursor: pointer;
      }
      main {
        padding: 28px;
      }
      .topbar {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 20px;
      }
      h1 { margin: 0; font-size: 28px; letter-spacing: -0.03em; }
      h2 { margin: 0; font-size: 18px; letter-spacing: -0.02em; }
      p { margin: 6px 0 0; color: #64748b; line-height: 1.55; }
      .actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
      .button, button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 38px;
        padding: 9px 13px;
        border: 0;
        border-radius: 10px;
        background: #0b63ce;
        color: #fff;
        text-decoration: none;
        font-weight: 900;
        cursor: pointer;
      }
      .ghost {
        border: 1px solid #cbd5e1;
        background: #fff;
        color: #0f172a;
      }
      .danger { color: #be123c; }
      .grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
        margin-bottom: 18px;
      }
      .metric {
        padding: 18px;
        border: 1px solid #dbe7f5;
        border-radius: 16px;
        background: #fff;
      }
      .metric span { display: block; color: #64748b; font-size: 13px; font-weight: 800; }
      .metric strong { display: block; margin-top: 8px; font-size: 24px; }
      .section {
        margin-top: 16px;
        border: 1px solid #dbe7f5;
        border-radius: 16px;
        background: #fff;
        overflow: hidden;
      }
      .section-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 18px 20px;
        border-bottom: 1px solid #edf2f7;
      }
      .section-body { padding: 18px 20px; overflow: auto; }
      table { width: 100%; border-collapse: collapse; min-width: 860px; }
      th, td {
        padding: 13px 12px;
        border-bottom: 1px solid #edf2f7;
        text-align: left;
        font-size: 14px;
        white-space: nowrap;
      }
      th {
        background: #f8fafc;
        color: #334155;
        font-size: 13px;
      }
      tr.legacy { background: #fff7ed; }
      .warning {
        display: inline-block;
        margin-left: 8px;
        padding: 4px 7px;
        border-radius: 999px;
        background: #ffedd5;
        color: #c2410c;
        font-size: 12px;
        font-weight: 900;
      }
      .status-pill, .tid {
        display: inline-block;
        padding: 5px 9px;
        border-radius: 999px;
        background: #eff6ff;
        color: #0b63ce;
        font-weight: 900;
        font-size: 12px;
      }
      .form-grid {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 10px;
        align-items: end;
      }
      label { display: block; color: #334155; font-size: 13px; font-weight: 900; }
      input {
        width: 100%;
        height: 42px;
        margin-top: 6px;
        padding: 0 12px;
        border: 1px solid #cbd5e1;
        border-radius: 10px;
        font-size: 14px;
      }
      .empty { padding: 26px; color: #64748b; text-align: center; }
      .note {
        margin-top: 10px;
        padding: 12px 14px;
        border-radius: 12px;
        background: #f8fafc;
        color: #64748b;
        font-size: 13px;
      }
      @media (max-width: 960px) {
        .layout { grid-template-columns: 1fr; }
        aside { position: static; }
        .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .form-grid { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <div class="layout">
      <aside>
        <div class="brand">
          <strong>UBCn Coupon</strong>
          <span>관리 콘솔</span>
        </div>
        <div class="profile">
          <b>${escapeHtml(session.username)}</b>
          <span class="role">${isAdmin ? "관리자" : "운영자"}</span>
          <p>${escapeHtml(isAdmin ? "유비씨엔 직원 권한" : session.merchantName ?? "가맹사 권한")}</p>
        </div>
        <nav>
          <a class="active" href="#summary">현황 요약</a>
          <a href="#devices">단말기 현황</a>
          <a href="#issues">발급 기록</a>
          ${isAdmin ? `<a href="#operators">운영자 계정</a>` : ""}
        </nav>
        <form method="post" action="/admin">
          <input type="hidden" name="action" value="logout" />
          <button class="logout" type="submit">로그아웃</button>
        </form>
      </aside>
      <main>
        <header class="topbar" id="summary">
          <div>
            <h1>쿠폰 발급 관리자</h1>
            <p>발급 기록은 1일 후 자동 삭제됩니다. 관리자와 운영자 권한을 구분해 확인할 수 있습니다.</p>
          </div>
          <div class="actions">
            <a class="button" href="/admin">새로고침</a>
            ${
              isAdmin && legacyCount > 0
                ? `<form method="post" action="/admin">
                    <input type="hidden" name="action" value="cleanLegacy" />
                    <button class="ghost danger" type="submit">24시간 초과 기록 정리</button>
                  </form>`
                : ""
            }
          </div>
        </header>

        <section class="grid">
          <div class="metric"><span>보관 정책</span><strong>1일</strong></div>
          <div class="metric"><span>발급 기록</span><strong>${rows.length}건</strong></div>
          <div class="metric"><span>발급 완료</span><strong>${issuedCount}건</strong></div>
          <div class="metric"><span>운영자 계정</span><strong>${activeOperatorCount}개</strong></div>
        </section>

        <section class="section" id="devices">
          <div class="section-head">
            <div>
              <h2>등록 단말기 현황</h2>
              <p>TID, 설치 위치, 자판기 모델을 한눈에 확인합니다.</p>
            </div>
          </div>
          <div class="section-body">${renderDeviceRows(devices)}</div>
        </section>

        <section class="section" id="issues">
          <div class="section-head">
            <div>
              <h2>쿠폰 발급 기록</h2>
              <p>같은 번호 중복 발급 차단을 위해 1일 동안만 보관됩니다.</p>
            </div>
          </div>
          <div class="section-body">
            ${renderIssueRows(rows)}
            ${
              legacyCount > 0
                ? `<div class="note">44시간처럼 보였던 기록은 예전 3일 보관 테스트 때 저장된 이전 기록입니다. 화면에서는 1일 정책으로 보정 표시하며, 관리자는 정리 버튼으로 삭제할 수 있습니다.</div>`
                : ""
            }
          </div>
        </section>

        ${
          isAdmin
            ? `<section class="section" id="operators">
                <div class="section-head">
                  <div>
                    <h2>운영자 계정 관리</h2>
                    <p>운영자 계정 등록과 삭제는 관리자만 할 수 있습니다.</p>
                  </div>
                </div>
                <div class="section-body">
                  <form class="form-grid" method="post" action="/admin">
                    <input type="hidden" name="action" value="createOperator" />
                    <label>아이디
                      <input name="username" placeholder="merchant01" required />
                    </label>
                    <label>임시 비밀번호
                      <input name="password" type="password" required />
                    </label>
                    <label>소속/가맹사
                      <input name="merchantName" placeholder="예: 테스트 가맹사" required />
                    </label>
                    <label>담당자
                      <input name="contactName" placeholder="예: 홍길동" />
                    </label>
                    <label>메모
                      <input name="memo" placeholder="확인용 메모" />
                    </label>
                    <button type="submit">운영자 등록</button>
                  </form>
                  <div class="note">실제 운영 단계에서는 회사 계정 시스템 또는 별도 DB로 교체하는 것을 권장합니다. 현재는 프로토타입용 Redis 저장 방식입니다.</div>
                </div>
                <div class="section-body">${renderOperatorRows(operators)}</div>
              </section>`
            : ""
        }
      </main>
    </div>
  </body>
</html>`;
}

async function authenticate(formData: FormData): Promise<Session | null> {
  const username = normalizeUsername(String(formData.get("username") ?? ""));
  const password = String(formData.get("password") ?? "");
  const expiresAt = Date.now() + 1000 * 60 * 60 * 8;

  if (username === "admin" && password === process.env.ADMIN_PASSWORD) {
    return {
      username: "admin",
      role: "admin",
      merchantName: "UBCn",
      exp: expiresAt,
    };
  }

  const operator = await getOperator(username);

  if (operator && operator.passwordHash === hashPassword(password)) {
    return {
      username: operator.username,
      role: "operator",
      merchantName: operator.merchantName,
      exp: expiresAt,
    };
  }

  return null;
}

export async function GET(request: Request) {
  if (!process.env.ADMIN_PASSWORD) {
    return new Response("ADMIN_PASSWORD 환경변수를 먼저 설정해 주세요.", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  if (!getRedisConfig()) {
    return new Response("Redis 저장소 환경변수가 설정되어 있지 않습니다.", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const url = new URL(request.url);
  const session = readSession(request);

  if (!session) {
    return new Response(renderLogin(url.searchParams.get("error") === "1"), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const [rows, operators] = await Promise.all([getRows(), getOperators()]);

  return new Response(
    renderAdminPage({
      session,
      rows,
      operators,
      devices: getDevices(),
    }),
    {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    },
  );
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const action = String(formData.get("action") ?? "");

  if (action === "login") {
    const session = await authenticate(formData);

    if (!session) {
      return redirectTo("/admin?error=1");
    }

    return redirectTo("/admin", createSessionCookie(session));
  }

  if (action === "logout") {
    return redirectTo("/admin", clearSessionCookie());
  }

  const session = readSession(request);

  if (!session || session.role !== "admin") {
    return new Response("관리자 권한이 필요합니다.", {
      status: 403,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  if (action === "createOperator") {
    await createOperator(formData);
    return redirectTo("/admin#operators");
  }

  if (action === "deleteOperator") {
    await deleteOperator(formData);
    return redirectTo("/admin#operators");
  }

  if (action === "cleanLegacy") {
    const rows = await getRows();
    await cleanLegacyTtlRows(rows);
    return redirectTo("/admin#issues");
  }

  return redirectTo("/admin");
}
