# MYDAS Telegram login and mainland SMS policy

Telegram Login uses BotFather Login Widget Client ID/Secret (not a Bot API token). Register the exact connector callback URL shown by Logto, keep RS256 enabled, then create/enable the Telegram connector and place it first in social login options. Test real consent and existing-account linking before rollout. Users who decline phone sharing may need profile completion depending on tenant settings.

The fork restricts verification-code creation and delivery to normalized mainland numbers (`86` followed by 11 digits). This covers sign-in, registration, recovery, MFA, account and management verification-code flows through the shared passcode library. Other country codes return HTTP 422 `verification_code.mainland_only`. Email is unaffected. The browser shows localized guidance and rejects unsupported SMS requests before CAPTCHA. Phone password sign-in is not disabled.

Before deploying, back up the database and connector/config directory. The historical mixed SMS connector should additionally reject non-mainland destinations, including its admin test path. Keep domestic forwarding unchanged. Enable Telegram with verified credentials before directing users to it. Preserve other social login methods and avoid forcing overseas users through SMS-based profile completion or MFA.
