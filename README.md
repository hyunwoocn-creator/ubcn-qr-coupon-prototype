# QR 기반 쿠폰 발급 프로토타입

자판기에 부착된 QR을 스캔한 고객이 모바일 페이지에서 개인번호 또는 휴대폰 번호를 입력하고, 개인정보 수집 및 이용에 동의한 뒤 쿠폰을 발급받는 Next.js 프로토타입입니다.

현재는 Mock API 기준으로 동작하며, 실제 UBCn 쿠폰 API 명세가 준비되면 서버 코드와 환경변수만 교체해서 연결할 수 있습니다.

## 프로젝트 구조

```text
coupon-prototype/
├─ app/
│  ├─ api/
│  │  └─ coupons/
│  │     └─ issue/
│  │        ├─ route.ts          # 브라우저가 호출하는 서버 API Route
│  │        └─ form/route.ts     # 자바스크립트가 꺼져도 동작하는 폼 제출용 Route
│  ├─ globals.css                # 모바일 QR 페이지 스타일
│  ├─ admin/route.ts             # 비밀번호로 보호되는 관리자 화면
│  ├─ layout.tsx                 # 공통 HTML 레이아웃
│  └─ page.tsx                   # 쿠폰 발급 신청 페이지와 성공/실패 화면
├─ lib/
│  ├─ couponClient.ts            # Mock/실제 API 전환 처리
│  ├─ couponConfig.ts            # .env 값을 읽는 설정 파일
│  ├─ issuedCouponStore.ts       # 1일 중복 발급 차단 저장소
│  └─ mockCouponApi.ts           # Mock API 처리 코드
├─ public/
│  └─ images/ubcn.png            # UBCn 로고
├─ .env.example                  # 환경변수 설정 예시
├─ vercel.json                   # Vercel 배포 설정
└─ package.json
```

## 로컬 실행

```bash
cd outputs/coupon-prototype
npm install
copy .env.example .env.local
npm run dev
```

브라우저에서 `http://localhost:3000`으로 접속하면 됩니다.

## Vercel 배포

```bash
cd outputs/coupon-prototype
npx vercel login
npx vercel --prod
```

배포 후 Vercel 프로젝트의 `Settings > Environment Variables`에서 아래 값을 등록하세요.

```env
USE_MOCK_API=false
UBCN_COUPON_API_URL=실제_UBCn_쿠폰_API_URL
UBCN_COUPON_API_KEY=실제_API_KEY
UBCN_CHANNEL_CODE=실제_채널_코드
UBCN_CAMPAIGN_CODE=실제_캠페인_코드
ISSUED_COUPON_TTL_SECONDS=86400
UPSTASH_REDIS_REST_URL=Upstash_또는_Vercel_KV_REST_URL
UPSTASH_REDIS_REST_TOKEN=Upstash_또는_Vercel_KV_REST_TOKEN
ADMIN_PASSWORD=관리자_화면_비밀번호
```

실제 API 명세가 아직 준비되지 않았거나 화면만 테스트하려면 `USE_MOCK_API=true`로 둡니다.

## 1일 중복 발급 차단

같은 번호로 1일 안에 다시 발급받지 못하게 하려면 Redis 저장소 환경변수가 필요합니다.

- 번호 원문은 저장하지 않습니다.
- 번호에서 공백과 하이픈을 제거한 뒤 SHA-256 해시값을 저장합니다.
- 저장된 해시값은 `ISSUED_COUPON_TTL_SECONDS` 기준으로 자동 만료됩니다.
- 기본값 `86400`초는 1일입니다.
- 저장소 환경변수가 없으면 Vercel 서버리스 환경에서는 중복 발급 기록을 안정적으로 유지할 수 없습니다.

## Mock API 테스트 값

- `01000000000` 입력: 실패, `이미 발급된 번호입니다.`
- 그 외 번호 입력: 성공, 쿠폰번호 `CP12345678`

저장소 환경변수를 연결한 뒤에는 같은 번호로 1일 안에 다시 요청하면 `이미 발급된 번호입니다.`가 표시됩니다.

## 관리자 화면

관리자 화면은 `/admin`입니다.

```text
https://coupon-prototype.vercel.app/admin
```

접속하면 브라우저가 사용자명과 비밀번호를 물어봅니다.

- 사용자명: 아무 값이나 입력해도 됩니다.
- 비밀번호: Vercel 환경변수 `ADMIN_PASSWORD` 값

관리자 화면에는 1일 동안 보관되는 발급 기록이 표시됩니다. 1일이 지나면 Redis TTL에 의해 자동 삭제됩니다.

## 실제 UBCn API 적용 시 수정할 곳

- `lib/couponConfig.ts`: 실제 API URL, API Key, 채널 코드, 캠페인 코드 설정
- `lib/couponClient.ts`: 실제 API 요청 파라미터, 헤더, 응답값 매핑
- `app/api/coupons/issue/route.ts`: 화면에서 받을 입력값이 추가될 경우 검증 로직 수정
