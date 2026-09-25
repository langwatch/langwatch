// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Every `sessionPolicy.*` procedure, declared once, at main's wire names. */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

export const organizationSessionPolicySchema = z
  .object({ maxSessionDurationDays: z.number().int().nonnegative() })
  .strict();
export type OrganizationSessionPolicyShape = z.infer<typeof organizationSessionPolicySchema>;

export const sessionCeilingAppliedSchema = z
  .object({ ok: z.literal(true), reapedSessions: z.number().int().nonnegative() })
  .strict();
export type SessionCeilingApplied = z.infer<typeof sessionCeilingAppliedSchema>;

export const sessionPolicyTrpc = defineTrpcContract("sessionPolicy")
  .query("get")
  .withInput(z.object({ organizationId: z.string() }))
  .withOutput(organizationSessionPolicySchema)

  .mutation("setMaxDuration")
  .withInput(
    z.object({
      organizationId: z.string(),
      maxSessionDurationDays: z.number().int().min(0).max(365),
    }),
  )
  .withOutput(sessionCeilingAppliedSchema)
  .build();
