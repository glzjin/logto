import { redisCache } from '#src/caches/index.js';
import RequestError from '#src/errors/RequestError/index.js';

/**
 * Mydas stop-gap for verification code abuse (2026-10-28 SMS pumping incident; upstream
 * discussion in logto-io/logto#9909). Every verification code send from the experience API
 * reserves one unit from each budget that applies to the sender, atomically (Redis INCR) and
 * before the connector is called, so concurrent requests cannot share a stale count. The budget
 * fails closed: without Redis no code is sent.
 */
export type SendBudgetWindow = {
  /** Window length in seconds; also the counter TTL. */
  seconds: number;
  /** Sends allowed within the window. */
  max: number;
};

export type SendBudgetOwner = {
  /** Stable key of who is sending, e.g. `captcha:<solve id>` or `user:<id>`. */
  key: string;
  windows: SendBudgetWindow[];
  /** The error to throw when this owner is over budget. */
  exceeded: () => RequestError;
};

export const sendBudgetPolicy = Object.freeze({
  /** Sends one solved captcha covers (a code and one resend). */
  perCaptchaSolve: [{ seconds: 3600, max: 2 }],
  /** Identified users (incl. step-up subjects and MFA), across interactions. */
  perUser: [
    { seconds: 3600, max: 5 },
    { seconds: 86_400, max: 10 },
  ],
  /** Social / SSO identities that skipped the captcha before a user was identified. */
  perIdentity: [
    { seconds: 3600, max: 5 },
    { seconds: 86_400, max: 10 },
  ],
  /** Interactions without any captcha because the captcha policy is disabled. */
  perInteraction: [{ seconds: 3600, max: 5 }],
  /** Client IP, independent of sendproxy's own IP limits. Room for a classroom behind one NAT. */
  perIp: [
    { seconds: 600, max: 20 },
    { seconds: 3600, max: 60 },
  ],
} satisfies Record<string, SendBudgetWindow[]>);

export const sendBudgetExceeded = () =>
  new RequestError({ code: 'verification_code.send_budget_exceeded', status: 429 });

const sendBudgetUnavailable = () =>
  new RequestError({ code: 'verification_code.send_budget_unavailable', status: 503 });

const budgetKey = (tenantId: string, ownerKey: string, seconds: number) =>
  `send-budget:${tenantId}:${ownerKey}:${seconds}`;

/**
 * Reserve one send from every window of every owner, or none of them.
 *
 * @throws the owner's `exceeded()` error when a window is full, or 503
 * `verification_code.send_budget_unavailable` when Redis is unavailable (fail closed).
 */
export async function reserveSendBudget(tenantId: string, owners: SendBudgetOwner[]) {
  const { client } = redisCache;

  if (!client?.isOpen) {
    throw sendBudgetUnavailable();
  }

  const taken: string[] = [];

  try {
    for (const owner of owners) {
      for (const { seconds, max } of owner.windows) {
        const key = budgetKey(tenantId, owner.key, seconds);
        // eslint-disable-next-line no-await-in-loop
        const count = await client.incr(key);
        // eslint-disable-next-line @silverhand/fp/no-mutating-methods
        taken.push(key);

        // A lost EXPIRE would make the counter permanent (failing closed); repair it on the next send.
        // eslint-disable-next-line no-await-in-loop
        if (count === 1 || (await client.ttl(key)) < 0) {
          // eslint-disable-next-line no-await-in-loop
          await client.expire(key, seconds);
        }

        if (count > max) {
          throw owner.exceeded();
        }
      }
    }
  } catch (error: unknown) {
    // Refund a partial reservation so a rejected request does not consume other budgets.
    await Promise.allSettled(taken.map(async (key) => client.decr(key)));

    if (error instanceof RequestError) {
      throw error;
    }

    throw sendBudgetUnavailable();
  }
}
