import { createHash } from "node:crypto";

import type { IssueCouponResult } from "./mockCouponApi";

type StoreConfig = {
  url: string;
  token: string;
  ttlSeconds: number;
};

type ReservationResult =
  | { enabled: false }
  | { enabled: true; reserved: true; key: string }
  | { enabled: true; reserved: false; key: string };

function getStoreConfig(): StoreConfig | null {
  const url =
    process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL ?? "";
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ??
    process.env.KV_REST_API_TOKEN ??
    "";
  const ttlSeconds = Number(process.env.ISSUED_COUPON_TTL_SECONDS ?? 86400);

  if (!url || !token) {
    return null;
  }

  return {
    url: url.replace(/\/$/, ""),
    token,
    ttlSeconds: Number.isFinite(ttlSeconds) ? ttlSeconds : 86400,
  };
}

function normalizeIdentifier(customerIdentifier: string) {
  return customerIdentifier.replace(/[\s-]/g, "").trim();
}

function maskIdentifier(customerIdentifier: string) {
  const normalized = normalizeIdentifier(customerIdentifier);

  if (normalized.length <= 4) {
    return normalized;
  }

  const head = normalized.slice(0, 3);
  const tail = normalized.slice(-4);
  const maskLength = Math.max(0, normalized.length - head.length - tail.length);

  return `${head}${"*".repeat(maskLength)}${tail}`;
}

function createIdentifierKey(customerIdentifier: string) {
  const normalized = normalizeIdentifier(customerIdentifier);
  const hash = createHash("sha256").update(normalized).digest("hex");

  return `coupon-issued:${hash}`;
}

async function runRedisCommand<T>(command: unknown[]): Promise<T> {
  const config = getStoreConfig();

  if (!config) {
    throw new Error("Issued coupon store is not configured.");
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
    throw new Error("Issued coupon store request failed.");
  }

  const data = (await response.json()) as { result: T };
  return data.result;
}

export async function reserveCouponIssue(
  customerIdentifier: string,
): Promise<ReservationResult> {
  const config = getStoreConfig();

  if (!config) {
    return { enabled: false };
  }

  const key = createIdentifierKey(customerIdentifier);
  const reservedAt = new Date().toISOString();
  const normalizedIdentifier = normalizeIdentifier(customerIdentifier);
  const maskedIdentifier = maskIdentifier(customerIdentifier);

  /*
   * SET NX EX로 1일짜리 예약 기록을 먼저 만듭니다.
   * 이미 같은 번호 해시가 있으면 UBCn API 호출 전 차단하여 중복 발급을 막습니다.
   */
  const result = await runRedisCommand<"OK" | null>([
    "SET",
    key,
    JSON.stringify({
      status: "pending",
      reservedAt,
      customerIdentifier: normalizedIdentifier,
      maskedIdentifier,
    }),
    "NX",
    "EX",
    config.ttlSeconds,
  ]);

  return {
    enabled: true,
    reserved: result === "OK",
    key,
  };
}

export async function completeCouponIssue(
  key: string,
  customerIdentifier: string,
  result: IssueCouponResult,
) {
  const config = getStoreConfig();

  if (!config) {
    return;
  }

  await runRedisCommand([
    "SET",
    key,
    JSON.stringify({
      status: "issued",
      issuedAt: new Date().toISOString(),
      customerIdentifier: normalizeIdentifier(customerIdentifier),
      maskedIdentifier: maskIdentifier(customerIdentifier),
      couponNumber: result.couponNumber ?? null,
    }),
    "EX",
    config.ttlSeconds,
  ]);
}

export async function releaseCouponIssueReservation(key: string) {
  if (!getStoreConfig()) {
    return;
  }

  await runRedisCommand(["DEL", key]);
}
