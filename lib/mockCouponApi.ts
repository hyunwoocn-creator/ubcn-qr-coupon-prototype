export type IssueCouponInput = {
  customerIdentifier: string;
};

export type IssueCouponResult = {
  success: boolean;
  couponNumber?: string;
  message: string;
};

export async function issueCouponByMockApi(
  input: IssueCouponInput,
): Promise<IssueCouponResult> {
  // 실제 API처럼 약간의 대기 시간을 두어 화면 흐름을 확인하기 쉽게 했습니다.
  await new Promise((resolve) => setTimeout(resolve, 450));

  // Mock API 조건: 01000000000은 이미 발급된 번호로 실패 처리합니다.
  if (input.customerIdentifier === "01000000000") {
    return {
      success: false,
      message: "이미 발급된 번호입니다.",
    };
  }

  // Mock API 조건: 그 외 번호는 성공 처리하고 예시 쿠폰번호를 반환합니다.
  return {
    success: true,
    couponNumber: "CP12345678",
    message: "쿠폰이 발급되었습니다.",
  };
}
