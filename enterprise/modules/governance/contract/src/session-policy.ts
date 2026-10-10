// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Every `sessionPolicy.*` procedure, declared once, at main's wire names. */
import { defineTrpcContract, type Named } from "@langwatch/module";
import { z } from "zod";

const organizationSessionPolicySchemaDefinition = z
  .object({ maxSessionDurationDays: z.number().int().nonnegative() })
  .strict();
export interface OrganizationSessionPolicySchema extends Named<
  typeof organizationSessionPolicySchemaDefinition
> {}
export const organizationSessionPolicySchema: OrganizationSessionPolicySchema =
  organizationSessionPolicySchemaDefinition;
export type OrganizationSessionPolicyShape = z.infer<typeof organizationSessionPolicySchema>;

const sessionCeilingAppliedSchemaDefinition = z
  .object({ ok: z.literal(true), reapedSessions: z.number().int().nonnegative() })
  .strict();
export interface SessionCeilingAppliedSchema extends Named<
  typeof sessionCeilingAppliedSchemaDefinition
> {}
export const sessionCeilingAppliedSchema: SessionCeilingAppliedSchema =
  sessionCeilingAppliedSchemaDefinition;
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
