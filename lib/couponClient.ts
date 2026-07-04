import { getCouponApiConfig } from "./couponConfig";
import {
  issueCouponByMockApi,
  type IssueCouponInput,
  type IssueCouponResult,
} from "./mockCouponApi";

export async function issueCoupon(
  input: IssueCouponInput,
): Promise<IssueCouponResult> {
  const config = getCouponApiConfig();

  if (config.useMockApi) {
    return issueCouponByMockApi(input);
  }

  return issueCouponByRealApi(input);
}

async function issueCouponByRealApi(
  input: IssueCouponInput,
): Promise<IssueCouponResult> {
  const config = getCouponApiConfig();

  if (!config.realApiUrl || !config.realApiKey) {
    return {
      success: false,
      message: "실제 쿠폰 API 설정이 필요합니다.",
    };
  }

  /*
   * 실제 UBCn 쿠폰 API 명세 적용 시 수정할 부분
   * 1. realApiUrl: UBCn에서 제공한 쿠폰 발권 API URL로 교체
   * 2. headers: 인증 방식이 x-api-key, Bearer Token, 서명 방식 중 무엇인지 확인 후 수정
   * 3. body: UBCn 요청 파라미터명에 맞게 연락처, 채널, 캠페인 값을 매핑
   * 4. responseData: UBCn 응답에서 성공 여부, 쿠폰번호, 기발권 메시지를 꺼내도록 수정
   *
   * 개인정보 저장 방침
   * - 이 프로젝트는 입력 번호를 DB, 파일, 리스트에 저장하지 않습니다.
   * - 번호는 아래 API 호출 본문에 담겨 UBCn 쿠폰 API로 전달되는 용도로만 사용합니다.
   */
  const response = await fetch(config.realApiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.realApiKey,
    },
    body: JSON.stringify({
      // TODO: 실제 UBCn 명세의 연락처/개인번호 파라미터명으로 변경하세요.
      customerIdentifier: input.customerIdentifier,

      // TODO: 실제 UBCn 명세에 맞게 채널/캠페인/자판기 식별자 등을 조정하세요.
      channelCode: config.channelCode,
      campaignCode: config.campaignCode,
    }),
  });

  if (!response.ok) {
    return {
      success: false,
      message: "쿠폰 발급 요청에 실패했습니다. 잠시 후 다시 시도해 주세요.",
    };
  }

  const responseData = await response.json();

  return {
    // TODO: 실제 UBCn 응답의 성공 코드 또는 상태값에 맞게 수정하세요.
    success: responseData.success === true,

    // TODO: 실제 UBCn 응답의 쿠폰번호 필드명에 맞게 수정하세요.
    couponNumber: responseData.couponNumber,

    // TODO: 실제 UBCn 응답의 기발권/실패 메시지 필드명에 맞게 수정하세요.
    message: responseData.message ?? "쿠폰 발급 처리가 완료되었습니다.",
  };
}
