import { assert, conditional } from '@silverhand/essentials';
import { got } from 'got';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';

import {
  type CreateConnector,
  type SocialConnector,
  type ConnectorMetadata,
  ConnectorType,
  ConnectorPlatform,
  ConnectorConfigFormItemType,
  ConnectorError,
  ConnectorErrorCodes,
  jsonGuard,
} from '@logto/connector-kit';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const issuer = 'https://oauth.telegram.org';
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
const configGuard = z.object({
  clientId: z.string().regex(/^\d+$/),
  clientSecret: z.string().min(1),
});
const sessionGuard = z.object({
  redirectUri: z.string().url(),
  codeVerifier: z.string().min(43),
  state: z.string().min(1),
  nonce: z.string().min(1),
});
const profileGuard = z.object({
  sub: z.string().min(1),
  name: z.string().optional(),
  picture: z.string().url().optional(),
  phone_number: z
    .string()
    .regex(/^\+?[1-9]\d{6,14}$/)
    .optional(),
  phone_number_verified: z.boolean().optional(),
  nonce: z.string().optional(),
});
const metadata: ConnectorMetadata = {
  id: 'telegram-universal',
  target: 'telegram',
  platform: ConnectorPlatform.Universal,
  name: { en: 'Telegram', 'zh-CN': 'Telegram', 'tr-TR': 'Telegram', ko: 'Telegram' },
  description: {
    en: 'Sign in with Telegram.',
    'zh-CN': '使用 Telegram 登录。',
    'tr-TR': 'Telegram ile giriş yapın.',
    ko: 'Telegram으로 로그인하세요.',
  },
  logo: './logo.svg',
  logoDark: null,
  readme: './README.md',
  formItems: ['clientId', 'clientSecret'].map((key) => ({
    key,
    type: ConnectorConfigFormItemType.Text,
    label: key === 'clientId' ? 'Client ID' : 'Client Secret',
    required: true,
  })),
};

const createTelegramConnector: CreateConnector<SocialConnector> = async ({ getConfig }) => ({
  metadata,
  type: ConnectorType.Social,
  configGuard,
  async getAuthorizationUri({ state, redirectUri }, setSession) {
    const { clientId } = configGuard.parse(await getConfig(metadata.id));
    const codeVerifier = randomBytes(32).toString('base64url');
    const nonce = randomBytes(32).toString('base64url');
    await setSession({ state, redirectUri, codeVerifier, nonce });
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid profile phone',
      state,
      nonce,
      code_challenge: createHash('sha256').update(codeVerifier).digest('base64url'),
      code_challenge_method: 'S256',
    });
    return `${issuer}/auth?${query.toString()}`;
  },
  async getUserInfo(data, getSession) {
    // Logto validates and consumes state before passing the callback to connectors.
    const callback = z
      .object({ code: z.string().min(1), state: z.string().min(1).optional() })
      .parse(data);
    const session = sessionGuard.parse(await getSession());
    assert(
      callback.state === undefined || callback.state === session.state,
      new ConnectorError(ConnectorErrorCodes.SocialAuthCodeInvalid)
    );
    const { clientId, clientSecret } = configGuard.parse(await getConfig(metadata.id));
    const response = await got
      .post(`${issuer}/token`, {
        headers: {
          authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        },
        form: {
          grant_type: 'authorization_code',
          code: callback.code,
          client_id: clientId,
          redirect_uri: session.redirectUri,
          code_verifier: session.codeVerifier,
        },
        timeout: { request: 10_000 },
        retry: { limit: 0 },
      })
      .json<unknown>();
    const { id_token: idToken } = z.object({ id_token: z.string().min(1) }).parse(response);
    const { payload } = await jwtVerify(idToken, jwks, {
      issuer,
      audience: clientId,
      algorithms: ['RS256'],
      requiredClaims: ['sub', 'iat', 'exp'],
      maxTokenAge: '10m',
      clockTolerance: 10,
    });
    const profile = profileGuard.parse(payload);
    // PKCE and the session-bound state protect providers that omit the optional nonce claim.
    assert(
      !profile.nonce || profile.nonce === session.nonce,
      new ConnectorError(ConnectorErrorCodes.SocialIdTokenInvalid)
    );
    return {
      id: profile.sub,
      name: profile.name,
      avatar: profile.picture,
      phone: conditional(profile.phone_number_verified && profile.phone_number?.replace(/^\+/, '')),
      rawData: jsonGuard.parse(payload),
    };
  },
});

export default createTelegramConnector;
