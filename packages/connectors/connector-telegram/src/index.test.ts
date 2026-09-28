import nock from 'nock';
import { createHash } from 'node:crypto';

import { type ConnectorSession } from '@logto/connector-kit';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';

import createConnector from './index.js';

const issuer = 'https://oauth.telegram.org';
const config = { clientId: '123456', clientSecret: 'test-secret' };
const keys = await generateKeyPair('RS256');
const publicJwk = await exportJWK(keys.publicKey);
const connector = await createConnector({ getConfig: async () => config });
const setSession = vi.fn();
const begin = async () => {
  const uri = await connector.getAuthorizationUri(
    {
      state: 'state',
      redirectUri: 'https://example.com/callback',
      connectorId: 'telegram',
      connectorFactoryId: 'telegram-universal',
      jti: 'jti',
      headers: {},
    },
    setSession
  );
  const session = setSession.mock.lastCall?.[0] as ConnectorSession & { codeVerifier: string };
  return { uri: new URL(uri), session };
};
const token = async (claims = {}, audience = config.clientId, expiration = '5m') =>
  new SignJWT({ phone_number: '+14155552671', phone_number_verified: true, ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'test' })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject('telegram-user')
    .setIssuedAt()
    .setExpirationTime(expiration)
    .sign(keys.privateKey);

beforeAll(() => {
  nock(issuer)
    .get('/.well-known/jwks.json')
    .reply(200, { keys: [{ ...publicJwk, kid: 'test', alg: 'RS256' }] })
    .persist();
});
afterAll(() => {
  nock.cleanAll();
});

it('accepts the Logto callback without state and maps only verified phone claims with S256 PKCE', async () => {
  const { uri, session } = await begin();
  expect(uri.searchParams.get('scope')).toBe('openid profile phone');
  expect(uri.searchParams.get('code_challenge')).toBe(
    createHash('sha256').update(session.codeVerifier).digest('base64url')
  );
  const request = nock(issuer, {
    reqheaders: { authorization: `Basic ${Buffer.from('123456:test-secret').toString('base64')}` },
  })
    .post(
      '/token',
      (body) =>
        body.code_verifier === session.codeVerifier && body.redirect_uri === session.redirectUri
    )
    .reply(200, { id_token: await token({ nonce: session.nonce }) });
  expect(
    await connector.getUserInfo(
      { code: 'code', redirectUri: session.redirectUri },
      async () => session
    )
  ).toMatchObject({ id: 'telegram-user', phone: '14155552671' });
  expect(request.isDone()).toBe(true);
  nock(issuer)
    .post('/token')
    .reply(200, { id_token: await token({ phone_number_verified: false }) });
  const unverified = await connector.getUserInfo(
    { code: 'code', state: 'state' },
    async () => session
  );
  expect(unverified.phone).toBeUndefined();
});

it('rejects mismatched state before token exchange', async () => {
  const { session } = await begin();
  await expect(
    connector.getUserInfo({ code: 'code', state: 'attacker' }, async () => session)
  ).rejects.toThrow();
});

it('rejects invalid audience, expired tokens and mismatched nonce', async () => {
  const { session } = await begin();
  for (const idToken of [
    await token({}, 'wrong-client'),
    await token({}, config.clientId, '-1h'),
    await token({ nonce: 'wrong-nonce' }),
  ]) {
    nock(issuer).post('/token').reply(200, { id_token: idToken });
    // eslint-disable-next-line no-await-in-loop -- Each mocked token response must be consumed before installing the next.
    await expect(
      connector.getUserInfo({ code: 'code', state: 'state' }, async () => session)
    ).rejects.toThrow();
  }
});
