"use client";

import { FormEvent, useState } from "react";

type CouponResult = {
  success: boolean;
  couponNumber?: string;
  message: string;
};

function getOnlyDigits(value: string) {
  return value.replace(/\D/g, "").slice(0, 11);
}

function formatPhoneNumber(value: string) {
  const digits = getOnlyDigits(value);

  if (digits.length <= 3) {
    return digits;
  }

  if (digits.length <= 7) {
    return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  }

  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

function isValidPhoneNumber(value: string) {
  return getOnlyDigits(value).length === 11;
}

export default function CouponIssuePage() {
  const [customerIdentifier, setCustomerIdentifier] = useState("");
  const [agreedToPrivacy, setAgreedToPrivacy] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState("");
  const [result, setResult] = useState<CouponResult | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFieldError("");

    const digits = getOnlyDigits(customerIdentifier);

    if (!digits) {
      setFieldError("휴대폰 번호를 입력해 주세요.");
      window.alert("휴대폰 번호를 입력해 주세요.");
      return;
    }

    if (!isValidPhoneNumber(customerIdentifier)) {
      const message =
        "휴대폰 번호는 숫자 11자리로 입력해 주세요. 예: 010-2824-0609";
      setFieldError(message);
      window.alert(message);
      return;
    }

    if (!agreedToPrivacy) {
      setFieldError("개인정보 수집·이용에 동의해 주세요.");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/coupons/issue", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          customerIdentifier: digits,
          agreedToPrivacy,
        }),
      });

      const data = (await response.json()) as CouponResult;
      setResult(data);
    } catch {
      setResult({
        success: false,
        message: "네트워크 상태를 확인한 뒤 다시 시도해 주세요.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  function resetForm() {
    setCustomerIdentifier("");
    setAgreedToPrivacy(false);
    setFieldError("");
    setResult(null);
  }

  return (
    <main className="page">
      <section className="phone-shell" aria-label="쿠폰 발급 신청">
        <div className="brand-strip">
          <div className="brand-mark">
            <img className="brand-logo" src="/images/ubcn.png" alt="UBCn" />
            <span>Vending Coupon</span>
          </div>
          <span className="status-pill">QR 전용</span>
        </div>

        <div className="hero">
          <div className="hero-copy">
            <span className="eyebrow">자판기 1회권 쿠폰</span>
            <h1>쿠폰 발급 신청</h1>
            <p>
              아래 정보를 입력하시면 자판기에서 사용 가능한 1회권 쿠폰이
              발급됩니다.
            </p>
          </div>

          <div className="coupon-preview" aria-label="쿠폰 혜택 안내">
            <div>
              <span className="coupon-label">TODAY COUPON</span>
              <strong>1회 이용권</strong>
            </div>
            <span className="coupon-badge">무료 발급</span>
          </div>
        </div>

        {result ? (
          <ResultView result={result} onReset={resetForm} />
        ) : (
          <form
            className="form-area"
            method="post"
            action="/api/coupons/issue/form"
            onSubmit={handleSubmit}
          >
            <div className="section-title">
              <strong>발급 정보 입력</strong>
              <span>번호 확인 후 즉시 발급 결과를 안내합니다.</span>
            </div>

            {fieldError ? <p className="message error">{fieldError}</p> : null}

            <div className="field">
              <label htmlFor="customerIdentifier">휴대폰 번호</label>
              <input
                id="customerIdentifier"
                name="customerIdentifier"
                type="tel"
                inputMode="numeric"
                placeholder="예: 010-2824-0609"
                value={customerIdentifier}
                onChange={(event) =>
                  setCustomerIdentifier(formatPhoneNumber(event.target.value))
                }
                autoComplete="tel"
                maxLength={13}
              />
              <span className="help-text">
                숫자만 입력해도 자동으로 하이픈이 추가됩니다.
              </span>
            </div>

            <div className="privacy-box">
              <label className="agree-line">
                <input
                  type="checkbox"
                  name="agreedToPrivacy"
                  value="true"
                  checked={agreedToPrivacy}
                  onChange={(event) =>
                    setAgreedToPrivacy(event.target.checked)
                  }
                />
                <span>개인정보 수집·이용에 동의합니다.</span>
              </label>

              <dl className="privacy-copy">
                <div>
                  <dt>수집 항목</dt>
                  <dd>휴대폰 번호</dd>
                </div>
                <div>
                  <dt>수집 목적</dt>
                  <dd>쿠폰 발급 및 중복 발급 확인</dd>
                </div>
                <div>
                  <dt>보유 기간</dt>
                  <dd>중복 발급 확인을 위해 1일 보관 후 자동 삭제</dd>
                </div>
              </dl>
            </div>

            <button
              className="submit-button"
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? "발급 처리 중..." : "쿠폰 발급받기"}
            </button>

            <div className="notice-box">
              <strong>안내</strong>
              <p>
                같은 번호로 발급된 기록은 1일 동안 보관되며, 이후 자동
                삭제됩니다.
              </p>
            </div>
          </form>
        )}
      </section>
    </main>
  );
}

function ResultView({
  result,
  onReset,
}: {
  result: CouponResult;
  onReset: () => void;
}) {
  if (result.success) {
    return (
      <div className="result success" role="status" aria-live="polite">
        <div className="result-icon">✓</div>
        <span className="result-kicker">발급 완료</span>
        <h2>쿠폰 발급 신청이 완료되었습니다.</h2>
        <p>
          입력하신 휴대폰 번호로 쿠폰이 발송됩니다. 카카오톡 알림톡 또는
          MMS를 확인해 주세요.
        </p>
        <div className="notice-box">
          <strong>수신 안내</strong>
          <p>
            카카오톡을 사용할 수 없거나 알림톡 수신이 어려운 경우 MMS로
            발송될 수 있습니다.
          </p>
        </div>
        <button className="secondary-button" type="button" onClick={onReset}>
          다시 발급 신청하기
        </button>
      </div>
    );
  }

  return (
    <div className="result failure" role="alert">
      <div className="result-icon">!</div>
      <span className="result-kicker">발급 실패</span>
      <h2>쿠폰 발급에 실패했습니다.</h2>
      <p>{result.message}</p>
      <button className="secondary-button" type="button" onClick={onReset}>
        다시 입력하기
      </button>
    </div>
  );
}
