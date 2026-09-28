# GoCaptcha integration

Based on Logto v1.43.0. Requires GoCaptcha Service and Redis 6.2 or newer.

In **Security → CAPTCHA**, choose **GoCaptcha** and configure:

- Service URL: the HTTP(S) endpoint reachable by the Logto server.
- Slider configuration ID: `slide-default`, or another configured `slide-*` ID.
- Secret key: the GoCaptcha management API key.

Enable CAPTCHA after saving the provider. Keep the management key private and
use HTTPS when connecting across untrusted networks. No external browser SDK is
required. The browser only contacts Logto's same-origin Experience API.

Challenges expire after five minutes and are bound to the tenant and OIDC
interaction. Each submitted answer consumes its challenge atomically, including
incorrect answers. Upstream errors and unavailable Redis fail verification.
Use Refresh to request a new puzzle or Cancel to leave the form unchanged.

The integration requires these GoCaptcha Service endpoints:

- `GET /api/v1/public/get-data`
- `POST /api/v1/public/check-data`
- `DELETE /api/v1/manage/del-status-info` (authenticated with `X-API-Key`)

The existing Turnstile and reCAPTCHA providers remain available. Custom sign-in
UIs must implement the documented `POST /api/experience/captcha` flow and pass
the JSON answer as `captchaToken` when initializing the interaction.

Run the backend verification checks after installing dependencies:

```sh
pnpm -r prepack
pnpm --filter @logto/core build:test
pnpm --filter @logto/core test:only --runInBand go-captcha captcha-validator
```

Before upgrading an existing deployment, back up PostgreSQL, deployment settings
and custom connectors, retain the old image, and rehearse the database alteration
against a restored copy. Do not point the old image at an altered database unless
the relevant alterations have been confirmed backward compatible.
