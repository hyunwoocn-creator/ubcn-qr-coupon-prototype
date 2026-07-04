import { issueCoupon } from "@/lib/couponClient";
import {
  completeCouponIssue,
  releaseCouponIssueReservation,
  reserveCouponIssue,
} from "@/lib/issuedCouponStore";

function normalizePhoneNumber(value: string) {
  return value.replace(/\D/g, "");
}

function isValidPhoneNumber(value: string) {
  return /^010\d{8}$/.test(value);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function resultHtml({
  success,
  title,
  message,
  couponNumber,
}: {
  success: boolean;
  title: string;
  message: string;
  couponNumber?: string;
}) {
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const safeCouponNumber = couponNumber ? escapeHtml(couponNumber) : "";

  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
    <style>
      * { box-sizing: border-box; }
      body {
        min-height: 100vh;
        margin: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px 16px;
        background: #f5f7fb;
        color: #1f2937;
        font-family: Arial, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
      }
      .card {
        width: min(100%, 430px);
        padding: 24px;
        border: 1px solid #d9e0ea;
        border-radius: 8px;
        background: #fff;
        text-align: center;
        box-shadow: 0 18px 45px rgba(20, 39, 77, 0.14);
      }
      .icon {
        display: grid;
        width: 58px;
        height: 58px;
        margin: 0 auto 16px;
        place-items: center;
        border-radius: 50%;
        background: ${success ? "#0f8a4b" : "#d92d20"};
        color: #fff;
        font-size: 28px;
        font-weight: 900;
      }
      h1 { margin: 0 0 10px; font-size: 22px; }
      p { margin: 0 0 16px; color: #6b7280; line-height: 1.6; }
      .coupon {
        margin: 16px 0;
        padding: 16px;
        border-radius: 8px;
        background: #eaf1ff;
        color: #0d4ed3;
        font-size: 26px;
        font-weight: 900;
        letter-spacing: 1px;
      }
      a {
        display: block;
        min-height: 48px;
        padding: 14px;
        border: 1px solid #d9e0ea;
        border-radius: 8px;
        color: #1f2937;
        text-decoration: none;
        font-weight: 800;
      }
    </style>
  </head>
  <body>
    <main class="card">
      <div class="icon">${success ? "✓" : "!"}</div>
      <h1>${safeTitle}</h1>
      <p>${safeMessage}</p>
      ${safeCouponNumber ? `<div class="coupon">${safeCouponNumber}</div>` : ""}
      <a href="/">다시 입력하기</a>
    </main>
  </body>
</html>`;
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const customerIdentifier = normalizePhoneNumber(
    String(formData.get("customerIdentifier") ?? ""),
  );
  const agreedToPrivacy = formData.get("agreedToPrivacy") === "true";

  if (!customerIdentifier) {
    return new Response(
      resultHtml({
        success: false,
        title: "쿠폰 발급에 실패했습니다.",
        message: "휴대폰 번호를 입력해 주세요.",
      }),
      { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 400 },
    );
  }

  if (!isValidPhoneNumber(customerIdentifier)) {
    return new Response(
      resultHtml({
        success: false,
        title: "쿠폰 발급에 실패했습니다.",
        message: "휴대폰 번호는 010으로 시작하는 숫자 11자리로 입력해 주세요.",
      }),
      { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 400 },
    );
  }

  if (!agreedToPrivacy) {
    return new Response(
      resultHtml({
        success: false,
        title: "쿠폰 발급에 실패했습니다.",
        message: "개인정보 수집·이용에 동의해 주세요.",
      }),
      { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 400 },
    );
  }

  const reservation = await reserveCouponIssue(customerIdentifier);

  if (reservation.enabled && !reservation.reserved) {
    return new Response(
      resultHtml({
        success: false,
        title: "쿠폰 발급에 실패했습니다.",
        message: "이미 발급된 번호입니다.",
      }),
      { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 409 },
    );
  }

  const result = await issueCoupon({ customerIdentifier });

  if (reservation.enabled && reservation.reserved) {
    if (result.success) {
      await completeCouponIssue(reservation.key, customerIdentifier, result);
    } else {
      await releaseCouponIssueReservation(reservation.key);
    }
  }

  return new Response(
    resultHtml({
      success: result.success,
      title: result.success
        ? "쿠폰 발급 신청이 완료되었습니다."
        : "쿠폰 발급에 실패했습니다.",
      message: result.success
        ? "입력하신 휴대폰 번호로 쿠폰이 발송됩니다. 카카오톡 알림톡 또는 MMS를 확인해 주세요."
        : result.message,
      couponNumber: undefined,
    }),
    {
      headers: { "Content-Type": "text/html; charset=utf-8" },
      status: result.success ? 200 : 409,
    },
  );
}
