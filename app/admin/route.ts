import { Buffer } from "node:buffer";

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
};

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

function isAuthorized(request: Request) {
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword) {
    return false;
  }

  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Basic ")) {
    return false;
  }

  const decoded = Buffer.from(authorization.slice(6), "base64").toString(
    "utf8",
  );
  const [, password] = decoded.split(":");

  return password === adminPassword;
}

function unauthorized() {
  return new Response("관리자 비밀번호가 필요합니다.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="UBCn Coupon Admin"',
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatRemaining(ttlSeconds: number | null) {
  if (ttlSeconds === null || ttlSeconds < 0) {
    return "-";
  }

  const hours = Math.floor(ttlSeconds / 3600);
  const minutes = Math.floor((ttlSeconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}시간 ${minutes}분`;
  }

  return `${minutes}분`;
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

function renderAdmin(rows: AdminRow[]) {
  const tableRows = rows
    .map(
      (row) => `<tr>
        <td>${escapeHtml(row.customerIdentifier ?? row.maskedIdentifier ?? "-")}</td>
        <td>${escapeHtml(row.maskedIdentifier ?? "-")}</td>
        <td>${escapeHtml(row.couponNumber ?? "-")}</td>
        <td>${escapeHtml(row.status ?? "-")}</td>
        <td>${escapeHtml(row.issuedAt ?? row.reservedAt ?? "-")}</td>
        <td>${escapeHtml(formatRemaining(row.ttlSeconds))}</td>
      </tr>`,
    )
    .join("");

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
        padding: 24px;
        background: #f5f7fb;
        color: #172033;
        font-family: Arial, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
      }
      main { max-width: 1080px; margin: 0 auto; }
      header {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 18px;
      }
      h1 { margin: 0; font-size: 26px; }
      p { margin: 6px 0 0; color: #667085; }
      .card {
        overflow: auto;
        border: 1px solid #d7e0ea;
        border-radius: 8px;
        background: #fff;
      }
      table { width: 100%; border-collapse: collapse; min-width: 860px; }
      th, td {
        padding: 13px 14px;
        border-bottom: 1px solid #edf1f5;
        text-align: left;
        font-size: 14px;
        white-space: nowrap;
      }
      th { background: #f8fafc; font-size: 13px; }
      .empty { padding: 40px; text-align: center; color: #667085; }
      .refresh {
        display: inline-block;
        padding: 10px 13px;
        border-radius: 8px;
        background: #0b63ce;
        color: #fff;
        text-decoration: none;
        font-weight: 800;
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div>
          <h1>쿠폰 발급 관리자</h1>
          <p>번호 기록은 1일 후 자동 삭제됩니다. 최신 상태를 보려면 새로고침하세요.</p>
        </div>
        <a class="refresh" href="/admin">새로고침</a>
      </header>
      <section class="card">
        ${
          rows.length === 0
            ? `<div class="empty">저장된 발급 기록이 없습니다.</div>`
            : `<table>
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
                <tbody>${tableRows}</tbody>
              </table>`
        }
      </section>
    </main>
  </body>
</html>`;
}

export async function GET(request: Request) {
  if (!process.env.ADMIN_PASSWORD) {
    return new Response("ADMIN_PASSWORD 환경변수를 먼저 설정해 주세요.", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  if (!isAuthorized(request)) {
    return unauthorized();
  }

  if (!getRedisConfig()) {
    return new Response("Redis 저장소 환경변수가 설정되어 있지 않습니다.", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const rows = await getRows();

  return new Response(renderAdmin(rows), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
