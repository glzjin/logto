import { createMockUtils } from '@logto/shared/esm';

import RequestError from '#src/errors/RequestError/index.js';

const { jest } = import.meta;
const { mockEsm } = createMockUtils(jest);

const store = new Map<string, number>();
const ttls = new Map<string, number>();
const isOpen = jest.fn(() => true);
const redis = {
  get isOpen() {
    return isOpen();
  },
  // Each command is atomic like Redis; awaiting between them lets requests interleave.
  incr: jest.fn(async (key: string) => {
    await Promise.resolve();
    const value = (store.get(key) ?? 0) + 1;
    store.set(key, value);
    return value;
  }),
  decr: jest.fn(async (key: string) => {
    const value = (store.get(key) ?? 0) - 1;
    store.set(key, value);
    return value;
  }),
  ttl: jest.fn(async (key: string) => ttls.get(key) ?? -1),
  expire: jest.fn(async (key: string, seconds: number) => {
    ttls.set(key, seconds);
    return true;
  }),
};
mockEsm('#src/caches/index.js', () => ({ redisCache: { client: redis } }));

const { reserveSendBudget, sendBudgetExceeded } = await import('./send-budget.js');

const captchaRequired = () => new RequestError({ code: 'session.captcha_required', status: 422 });
const captchaOwner = {
  key: 'captcha:solve-1',
  windows: [{ seconds: 3600, max: 2 }],
  exceeded: captchaRequired,
};
const ipOwner = {
  key: 'ip:198.51.100.7',
  windows: [
    { seconds: 600, max: 20 },
    { seconds: 3600, max: 60 },
  ],
  exceeded: sendBudgetExceeded,
};

beforeEach(() => {
  store.clear();
  ttls.clear();
  jest.clearAllMocks();
  isOpen.mockReturnValue(true);
});

it('reserves every window and sets the TTL once', async () => {
  await reserveSendBudget('tenant', [captchaOwner, ipOwner]);

  expect(store).toEqual(
    new Map([
      ['send-budget:tenant:captcha:solve-1:3600', 1],
      ['send-budget:tenant:ip:198.51.100.7:600', 1],
      ['send-budget:tenant:ip:198.51.100.7:3600', 1],
    ])
  );
  expect(redis.expire).toHaveBeenCalledWith('send-budget:tenant:captcha:solve-1:3600', 3600);
  expect(redis.expire).toHaveBeenCalledTimes(3);
});

it('throws the owner error when a window is full and refunds the partial reservation', async () => {
  await reserveSendBudget('tenant', [captchaOwner, ipOwner]);
  await reserveSendBudget('tenant', [captchaOwner, ipOwner]);

  await expect(reserveSendBudget('tenant', [ipOwner, captchaOwner])).rejects.toMatchError(
    captchaRequired()
  );
  // The rejected request consumed nothing: the IP windows are back to 2.
  expect(store.get('send-budget:tenant:ip:198.51.100.7:600')).toBe(2);
  expect(store.get('send-budget:tenant:captcha:solve-1:3600')).toBe(2);
});

it('lets exactly the budget through when requests race', async () => {
  const results = await Promise.allSettled(
    Array.from({ length: 10 }, async () => reserveSendBudget('tenant', [captchaOwner]))
  );

  expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(2);
  expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(8);
});

it('fails closed without Redis or when Redis errors', async () => {
  const unavailable = new RequestError({
    code: 'verification_code.send_budget_unavailable',
    status: 503,
  });

  isOpen.mockReturnValue(false);
  await expect(reserveSendBudget('tenant', [captchaOwner])).rejects.toMatchError(unavailable);
  expect(redis.incr).not.toHaveBeenCalled();

  isOpen.mockReturnValue(true);
  await reserveSendBudget('tenant', [captchaOwner]);
  redis.incr.mockRejectedValueOnce(new Error('connection reset'));
  await expect(reserveSendBudget('tenant', [ipOwner])).rejects.toMatchError(unavailable);
});

it('repairs a counter whose TTL was lost', async () => {
  store.set('send-budget:tenant:captcha:solve-1:3600', 1);
  await reserveSendBudget('tenant', [captchaOwner]);

  expect(redis.expire).toHaveBeenCalledWith('send-budget:tenant:captcha:solve-1:3600', 3600);
});
