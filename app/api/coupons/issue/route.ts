import { NextResponse } from "next/server";
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

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const customerIdentifier = normalizePhoneNumber(
      String(body.customerIdentifier ?? ""),
    );
    const agreedToPrivacy = body.agreedToPrivacy === true;

    if (!customerIdentifier) {
      return NextResponse.json(
        { success: false, message: "휴대폰 번호를 입력해 주세요." },
        { status: 400 },
      );
    }

    if (!isValidPhoneNumber(customerIdentifier)) {
      return NextResponse.json(
        {
          success: false,
          message: "휴대폰 번호는 010으로 시작하는 숫자 11자리로 입력해 주세요.",
        },
        { status: 400 },
      );
    }

    if (!agreedToPrivacy) {
      return NextResponse.json(
        { success: false, message: "개인정보 수집·이용에 동의해 주세요." },
        { status: 400 },
      );
    }

    const reservation = await reserveCouponIssue(customerIdentifier);

    if (reservation.enabled && !reservation.reserved) {
      return NextResponse.json(
        { success: false, message: "이미 발급된 번호입니다." },
        { status: 409 },
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

    return NextResponse.json(result, {
      status: result.success ? 200 : 409,
    });
  } catch {
    return NextResponse.json(
      {
        success: false,
        message: "요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
      },
      { status: 500 },
    );
  }
}
