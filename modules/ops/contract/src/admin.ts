import { z } from "zod";

export const OPS_FEATURE_ID = "ops" as const;

export const adminIdentitySchema = z.object({
  email: z.string().nullable().optional(),
});

export type AdminIdentity = z.infer<typeof adminIdentitySchema>;

const adminAuditHeaderValueSchema = z.union([z.string(), z.array(z.string())]);

/** Transport-neutral request metadata needed by the audit adapter. */
export const adminAuditRequestSchema = z.object({
  headers: z.record(z.string(), adminAuditHeaderValueSchema),
  remoteAddress: z.string().optional(),
});

export type AdminAuditRequest = z.infer<typeof adminAuditRequestSchema>;

export const startImpersonationInputSchema = z.object({
  sessionId: z.string().min(1),
  impersonatorUserId: z.string().min(1),
  userIdToImpersonate: z.string().min(1),
  reason: z.string().min(1),
  req: adminAuditRequestSchema,
});

export type StartImpersonationInput = z.infer<typeof startImpersonationInputSchema>;

export const stopImpersonationInputSchema = z.object({
  sessionId: z.string().min(1),
});

export type StopImpersonationInput = z.infer<typeof stopImpersonationInputSchema>;

export const adminResourceNameSchema = z.enum([
  "user",
  "organization",
  "project",
  "subscription",
  "team",
]);

export type AdminResourceName = z.infer<typeof adminResourceNameSchema>;
