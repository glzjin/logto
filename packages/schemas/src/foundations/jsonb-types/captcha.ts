import { z } from 'zod';

export enum CaptchaType {
  RecaptchaEnterprise = 'RecaptchaEnterprise',
  Turnstile = 'Turnstile',
  GoCaptcha = 'GoCaptcha',
}

export enum RecaptchaEnterpriseMode {
  Invisible = 'invisible',
  Checkbox = 'checkbox',
}

export const turnstileConfigGuard = z.object({
  type: z.literal(CaptchaType.Turnstile),
  siteKey: z.string(),
  secretKey: z.string(),
});

export type TurnstileConfig = z.infer<typeof turnstileConfigGuard>;

export const recaptchaEnterpriseConfigGuard = z.object({
  type: z.literal(CaptchaType.RecaptchaEnterprise),
  siteKey: z.string(),
  secretKey: z.string(),
  projectId: z.string(),
  domain: z.string().optional(),
  mode: z.nativeEnum(RecaptchaEnterpriseMode).optional(),
});

export type RecaptchaEnterpriseConfig = z.infer<typeof recaptchaEnterpriseConfigGuard>;

export const goCaptchaConfigGuard = z.object({
  type: z.literal(CaptchaType.GoCaptcha),
  siteKey: z.string().regex(/^slide-[\w-]+$/),
  secretKey: z.string().min(32),
  domain: z
    .string()
    .url()
    .refine((value) => {
      const url = new URL(value);
      return (
        ['http:', 'https:'].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      );
    }),
});

export type GoCaptchaConfig = z.infer<typeof goCaptchaConfigGuard>;

export const goCaptchaChallengeGuard = z.object({
  token: z.string().uuid(),
  image: z.string(),
  tile: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  tileWidth: z.number().int().positive(),
  tileHeight: z.number().int().positive(),
  y: z.number().int().nonnegative(),
});

export type GoCaptchaChallenge = z.infer<typeof goCaptchaChallengeGuard>;

export const captchaConfigGuard = z.discriminatedUnion('type', [
  turnstileConfigGuard,
  recaptchaEnterpriseConfigGuard,
  goCaptchaConfigGuard,
]);

export type CaptchaConfig = z.infer<typeof captchaConfigGuard>;
