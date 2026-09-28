import { randomUUID } from 'node:crypto';

import { type GoCaptchaConfig } from '@logto/schemas';
import ky from 'ky';
import { commandOptions } from 'redis';
import { z } from 'zod';

import { redisCache } from '#src/caches/index.js';

const lifetime = 300;
const answerGuard = z.object({
  token: z.string().uuid(),
  x: z.number().int().min(0).max(4096),
  y: z.number().int().min(0).max(4096),
});
const imageGuard = z
  .string()
  .max(2_000_000)
  .regex(/^data:image\/(?:png|jpeg);base64,[\d\n\r+/=A-Za-z]+$/);
const resultGuard = z.object({ code: z.literal(200), data: z.literal('ok') });
const dataGuard = z.object({
  code: z.literal(200),
  data: z.object({
    captcha_key: z.string().regex(/^\d{1,32}$/),
    master_image_base64: imageGuard,
    thumb_image_base64: imageGuard,
    master_width: z.number().int().min(1).max(4096),
    master_height: z.number().int().min(1).max(4096),
    thumb_width: z.number().int().min(1).max(4096),
    thumb_height: z.number().int().min(1).max(4096),
    display_y: z.number().int().min(0).max(4096),
  }),
});

const clientFor = (config: GoCaptchaConfig) =>
  ky.create({
    prefixUrl: config.domain.replace(/\/$/, '') + '/',
    timeout: 5000,
    retry: 0,
    redirect: 'error',
  });

const bindingKey = (tenantId: string, sessionId: string, token: string) =>
  `gocaptcha:${tenantId}:${sessionId}:${token}`;

export async function createGoCaptcha(
  config: GoCaptchaConfig,
  tenantId: string,
  sessionId: string
) {
  const { client } = redisCache;
  if (!client?.isOpen) {
    throw new Error('GoCaptcha requires Redis');
  }
  const { data } = dataGuard.parse(
    await clientFor(config)
      .get('api/v1/public/get-data', {
        searchParams: { id: config.siteKey },
      })
      .json()
  );
  const token = randomUUID();
  await client.set(
    commandOptions({ signal: AbortSignal.timeout(5000) }),
    bindingKey(tenantId, sessionId, token),
    JSON.stringify({
      key: data.captcha_key,
      provider: config.domain,
      id: config.siteKey,
    }),
    { EX: lifetime }
  );
  return {
    token,
    image: data.master_image_base64,
    tile: data.thumb_image_base64,
    width: data.master_width,
    height: data.master_height,
    tileWidth: data.thumb_width,
    tileHeight: data.thumb_height,
    y: data.display_y,
  };
}

export async function verifyGoCaptcha(
  config: GoCaptchaConfig,
  tenantId: string,
  sessionId: string,
  token: string
) {
  const answer = answerGuard.parse(JSON.parse(token));
  const { client } = redisCache;
  if (!client?.isOpen) {
    return false;
  }
  // GETDEL atomically consumes this session's challenge before checking the answer, including failures.
  const stored = await client.getDel(
    commandOptions({ signal: AbortSignal.timeout(5000) }),
    bindingKey(tenantId, sessionId, answer.token)
  );
  if (!stored) {
    return false;
  }
  const binding = z
    .object({ key: z.string(), provider: z.string(), id: z.string() })
    .parse(JSON.parse(stored));
  if (binding.provider !== config.domain || binding.id !== config.siteKey) {
    return false;
  }
  const result = await clientFor(config)
    .post('api/v1/public/check-data', {
      json: { id: config.siteKey, captchaKey: binding.key, value: `${answer.x},${answer.y}` },
    })
    .json();
  const deleted = await clientFor(config)
    .delete('api/v1/manage/del-status-info', {
      headers: { 'X-API-Key': config.secretKey },
      searchParams: { captchaKey: binding.key },
    })
    .json();
  return resultGuard.safeParse(result).success && resultGuard.safeParse(deleted).success;
}
