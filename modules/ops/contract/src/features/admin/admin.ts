import type { Named } from "@langwatch/module";
import { z } from "zod";

export const OPS_FEATURE_ID = "ops" as const;

const adminIdentitySchemaDefinition = z.object({
  id: z.string().optional(),
  email: z.string().nullable().optional(),
});
export interface AdminIdentitySchema extends Named<typeof adminIdentitySchemaDefinition> {}
export const adminIdentitySchema: AdminIdentitySchema = adminIdentitySchemaDefinition;

export type AdminIdentity = z.infer<typeof adminIdentitySchema>;

const adminAuditHeaderValueSchema = z.union([z.string(), z.array(z.string())]);

/** Transport-neutral request metadata needed by the audit adapter. */
const adminAuditRequestSchemaDefinition = z.object({
  headers: z.record(z.string(), adminAuditHeaderValueSchema),
  remoteAddress: z.string().optional(),
});
export interface AdminAuditRequestSchema extends Named<typeof adminAuditRequestSchemaDefinition> {}
export const adminAuditRequestSchema: AdminAuditRequestSchema = adminAuditRequestSchemaDefinition;

export type AdminAuditRequest = z.infer<typeof adminAuditRequestSchema>;

const startImpersonationInputSchemaDefinition = z.object({
  sessionId: z.string().min(1),
  impersonatorUserId: z.string().min(1),
  userIdToImpersonate: z.string().min(1),
  reason: z.string().min(1),
  req: adminAuditRequestSchema,
});
export interface StartImpersonationInputSchema extends Named<
  typeof startImpersonationInputSchemaDefinition
> {}
export const startImpersonationInputSchema: StartImpersonationInputSchema =
  startImpersonationInputSchemaDefinition;

export type StartImpersonationInput = z.infer<typeof startImpersonationInputSchema>;

const stopImpersonationInputSchemaDefinition = z.object({
  sessionId: z.string().min(1),
});
export interface StopImpersonationInputSchema extends Named<
  typeof stopImpersonationInputSchemaDefinition
> {}
export const stopImpersonationInputSchema: StopImpersonationInputSchema =
  stopImpersonationInputSchemaDefinition;

export type StopImpersonationInput = z.infer<typeof stopImpersonationInputSchema>;

export const adminResourceNameSchema = z.enum([
  "user",
  "organization",
  "project",
  "subscription",
  "team",
]);

export type AdminResourceName = z.infer<typeof adminResourceNameSchema>;
