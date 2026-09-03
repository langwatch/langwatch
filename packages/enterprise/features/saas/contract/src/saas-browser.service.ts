import { z } from "zod";

export const SAAS_FEATURE_ID = "saas" as const;

export const saasBrowserUserSchema = z.object({
  id: z.string(),
  email: z.string().nullish(),
  name: z.string().nullish(),
  impersonator: z.string().nullish(),
});

export const saasBrowserScopeSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export type SaasBrowserUser = z.infer<typeof saasBrowserUserSchema>;
export type SaasBrowserScope = z.infer<typeof saasBrowserScopeSchema>;

export abstract class SaasBrowserService {
  abstract updateLastLogin(): void;
}
