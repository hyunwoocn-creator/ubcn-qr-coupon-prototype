export type CouponApiConfig = {
  useMockApi: boolean;
  realApiUrl: string;
  realApiKey: string;
  channelCode: string;
  campaignCode: string;
};

export function getCouponApiConfig(): CouponApiConfig {
  return {
    // .env.local에서 USE_MOCK_API=false로 바꾸면 실제 API 호출 구조로 전환됩니다.
    useMockApi: process.env.USE_MOCK_API !== "false",

    // 실제 UBCn API 명세가 확정되면 .env.local의 URL을 교체하세요.
    realApiUrl: process.env.UBCN_COUPON_API_URL ?? "",

    // API Key는 서버에서만 읽습니다. 브라우저 코드에서 이 값을 import하지 마세요.
    realApiKey: process.env.UBCN_COUPON_API_KEY ?? "",

    // 실제 API에서 채널, 제휴사, 캠페인 코드 등이 필요하면 이 값을 활용하세요.
    channelCode: process.env.UBCN_CHANNEL_CODE ?? "qr-vending",

    // 실제 이벤트/프로모션 코드가 있으면 .env 또는 Vercel 환경변수에 등록하세요.
    campaignCode: process.env.UBCN_CAMPAIGN_CODE ?? "sample-campaign",
  };
}
