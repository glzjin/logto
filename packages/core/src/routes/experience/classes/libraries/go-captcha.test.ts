import { CaptchaType, type GoCaptchaConfig } from '@logto/schemas';
import { createMockUtils } from '@logto/shared/esm';

const { jest } = import.meta;
const { mockEsm } = createMockUtils(jest);
const store = new Map<string, string>();
const isOpen = jest.fn(() => true);
const redis = {
  get isOpen() {
    return isOpen();
  },
  set: jest.fn(async (_options: unknown, key: string, value: string) => {
    store.set(key, value);
    return 'OK';
  }),
  getDel: jest.fn(async (_options: unknown, key: string) => {
    const value = store.get(key);
    store.delete(key);
    return value;
  }),
};
const generated = {
  code: 200,
  data: {
    captcha_key: '123456789',
    master_image_base64: 'data:image/jpeg;base64,YQ==',
    thumb_image_base64: 'data:image/png;base64,YQ==',
    master_width: 300,
    master_height: 220,
    thumb_width: 60,
    thumb_height: 60,
    display_y: 30,
  },
};
const postJson = jest.fn(async () => ({ code: 200, data: 'ok' }));
const deleteJson = jest.fn(async () => ({ code: 200, data: 'ok' }));
mockEsm('#src/caches/index.js', () => ({ redisCache: { client: redis } }));
mockEsm('ky', () => ({
  default: {
    create: () => ({
      get: () => ({ json: async () => generated }),
      post: () => ({ json: postJson }),
      delete: () => ({ json: deleteJson }),
    }),
  },
}));
const { createGoCaptcha, verifyGoCaptcha } = await import('./go-captcha.js');
const config: GoCaptchaConfig = {
  type: CaptchaType.GoCaptcha,
  siteKey: 'slide-default',
  domain: 'https://captcha.example.com',
  secretKey: 'test-only-management-key-not-for-production',
};
const answer = (token: string) => JSON.stringify({ token, x: 120, y: 30 });

beforeEach(() => {
  store.clear();
  jest.clearAllMocks();
  isOpen.mockReturnValue(true);
  postJson.mockResolvedValue({ code: 200, data: 'ok' });
  deleteJson.mockResolvedValue({ code: 200, data: 'ok' });
});

it('binds challenges to tenant and interaction; consumes concurrent attempts exactly once', async () => {
  const challenge = await createGoCaptcha(config, 'tenant', 'session');
  expect(redis.set).toHaveBeenCalledWith(
    expect.anything(),
    expect.any(String),
    expect.any(String),
    {
      EX: 300,
    }
  );
  expect(await verifyGoCaptcha(config, 'other', 'session', answer(challenge.token))).toBe(false);
  expect(await verifyGoCaptcha(config, 'tenant', 'other', answer(challenge.token))).toBe(false);
  const results = await Promise.all(
    [1, 2].map(async () => verifyGoCaptcha(config, 'tenant', 'session', answer(challenge.token)))
  );
  expect(results).toEqual(expect.arrayContaining([false, true]));
  expect(postJson).toHaveBeenCalledTimes(1);
  expect(await verifyGoCaptcha(config, 'tenant', 'session', answer(challenge.token))).toBe(false);
});

it('consumes incorrect answers, rejects expired challenges and fails closed on provider errors', async () => {
  const challenge = await createGoCaptcha(config, 'tenant', 'session');
  postJson.mockResolvedValueOnce({ code: 200, data: 'failure' });
  expect(await verifyGoCaptcha(config, 'tenant', 'session', answer(challenge.token))).toBe(false);
  expect(await verifyGoCaptcha(config, 'tenant', 'session', answer(challenge.token))).toBe(false);
  const expired = await createGoCaptcha(config, 'tenant', 'session');
  store.clear();
  expect(await verifyGoCaptcha(config, 'tenant', 'session', answer(expired.token))).toBe(false);
  const unavailable = await createGoCaptcha(config, 'tenant', 'session');
  postJson.mockRejectedValueOnce(new Error('upstream timeout'));
  await expect(
    verifyGoCaptcha(config, 'tenant', 'session', answer(unavailable.token))
  ).rejects.toThrow('upstream timeout');
  expect(await verifyGoCaptcha(config, 'tenant', 'session', answer(unavailable.token))).toBe(false);
});

it('rejects malformed tokens, changed providers, missing Redis and failed cleanup', async () => {
  await expect(verifyGoCaptcha(config, 'tenant', 'session', '{}')).rejects.toThrow();
  const changed = await createGoCaptcha(config, 'tenant', 'session');
  expect(
    await verifyGoCaptcha(
      { ...config, domain: 'https://other.example.com' },
      'tenant',
      'session',
      answer(changed.token)
    )
  ).toBe(false);
  const cleanup = await createGoCaptcha(config, 'tenant', 'session');
  deleteJson.mockResolvedValueOnce({ code: 200, data: 'no-ops' });
  expect(await verifyGoCaptcha(config, 'tenant', 'session', answer(cleanup.token))).toBe(false);
  isOpen.mockReturnValue(false);
  await expect(createGoCaptcha(config, 'tenant', 'session')).rejects.toThrow('requires Redis');
});
