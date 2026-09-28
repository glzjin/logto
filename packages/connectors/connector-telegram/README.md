# Telegram

Use Telegram Login (OIDC), not a Bot API token. In @BotFather, open the bot's Login Widget settings, register the exact redirect URI shown in Logto, and copy its Client ID and Client Secret. Keep RS256 signing enabled.

This connector requests `openid profile phone`, uses authorization code flow with S256 PKCE, validates Telegram-signed ID tokens, and imports a phone only when `phone_number_verified` is true. Users can decline sharing their phone. No separate UserInfo endpoint is used. Telegram identities use the stable subject, never username.

Official documentation: https://core.telegram.org/bots/telegram-login

Existing account linking must follow Logto's verified-identity/account-linking flow. Do not assign an existing account based on a phone entered by the browser. Test returning-user linking, declined phone consent, and required-profile settings before enabling the connector.
