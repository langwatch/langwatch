import { z } from "zod";

export const OPS_FEATURE_ID = "ops" as const;

export const adminIdentitySchema = z.object({
  email: z.string().nullable().optional(),
});

export type AdminIdentity = z.infer<typeof adminIdentitySchema>;

export const startImpersonationInputSchema = z.object({
  sessionId: z.string().min(1),
  impersonatorUserId: z.string().min(1),
  userIdToImpersonate: z.string().min(1),
  reason: z.string().min(1),
  req: z.unknown(),
});

export type StartImpersonationInput = z.infer<
  typeof startImpersonationInputSchema
>;

export const stopImpersonationInputSchema = z.object({
  sessionId: z.string().min(1),
});

export type StopImpersonationInput = z.infer<
  typeof stopImpersonationInputSchema
>;

export const adminResourceNameSchema = z.enum([
  "user",
  "organization",
  "project",
  "subscription",
]);

export type AdminResourceName = z.infer<typeof adminResourceNameSchema>;
