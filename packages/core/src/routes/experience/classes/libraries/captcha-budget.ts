import { redisCache } from '#src/caches/index.js';

const budgetLifetime = 600;
/** Password attempts allowed after each successful captcha verification. */
export const passwordAttemptsPerCaptcha = 5;

const budgetKey = (tenantId: string, sessionId: string) =>
  `captcha-budget:${tenantId}:${sessionId}`;

const getClient = () => {
  const { client } = redisCache;
  return client?.isOpen ? client : undefined;
};

/** Grant a fresh password attempt budget after the session passes a captcha. */
export async function resetCaptchaBudget(tenantId: string, sessionId: string) {
  await getClient()?.set(budgetKey(tenantId, sessionId), '0', { EX: budgetLifetime });
}

/**
 * Consume one password attempt from the session's captcha budget.
 * Fails open without Redis so captcha providers keep working on deployments without a cache.
 */
export async function consumeCaptchaBudget(tenantId: string, sessionId: string) {
  const client = getClient();

  if (!client) {
    return true;
  }

  const key = budgetKey(tenantId, sessionId);
  const count = await client.incr(key);

  if (count === 1) {
    await client.expire(key, budgetLifetime);
  }

  return count <= passwordAttemptsPerCaptcha;
}
