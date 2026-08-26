import { z } from "zod";

export const personalVirtualKeyScopeSchema = z
  .object({
    scopeType: z.enum(["ORGANIZATION", "TEAM", "PROJECT"]),
    scopeId: z.string().min(1),
  })
  .strict();

export const personalVirtualKeySchema = z
  .object({
    id: z.string().min(1),
    organizationId: z.string().min(1),
    name: z.string().min(1),
    description: z.string().nullable(),
    displayPrefix: z.string(),
    status: z.string().min(1),
    principalUserId: z.string().nullable(),
    routingPolicyId: z.string().nullable(),
    createdAtMs: z.number().int().nonnegative(),
    updatedAtMs: z.number().int().nonnegative(),
    lastUsedAtMs: z.number().int().nonnegative().nullable(),
    scopes: z.array(personalVirtualKeyScopeSchema),
  })
  .strict();
export type PersonalVirtualKey = z.infer<typeof personalVirtualKeySchema>;

export const issuedPersonalVirtualKeySchema = z
  .object({
    virtualKey: personalVirtualKeySchema,
    secret: z.string().min(1),
    baseUrl: z.string().url(),
    routingPolicyId: z.string().nullable(),
    id: z.string().min(1),
    label: z.string().min(1),
  })
  .strict();
export type IssuedPersonalVirtualKey = z.infer<typeof issuedPersonalVirtualKeySchema>;

export const ensureDefaultPersonalVirtualKeyInputSchema = z
  .object({
    userId: z.string().min(1),
    organizationId: z.string().min(1),
    displayName: z.string().nullable().optional(),
    displayEmail: z.string().nullable().optional(),
  })
  .strict();
export type EnsureDefaultPersonalVirtualKeyInput = z.infer<
  typeof ensureDefaultPersonalVirtualKeyInputSchema
>;

export const issuePersonalVirtualKeyInputSchema = z
  .object({
    userId: z.string().min(1),
    organizationId: z.string().min(1),
    personalProjectId: z.string().min(1),
    personalTeamId: z.string().min(1).optional(),
    label: z.string().min(1),
    routingPolicyId: z.string().nullable().optional(),
  })
  .strict();
export type IssuePersonalVirtualKeyInput = z.infer<
  typeof issuePersonalVirtualKeyInputSchema
>;

export const listPersonalVirtualKeysInputSchema = z
  .object({
    organizationId: z.string().min(1),
    userId: z.string().min(1).optional(),
  })
  .strict();
export type ListPersonalVirtualKeysInput = z.infer<
  typeof listPersonalVirtualKeysInputSchema
>;

export const revokePersonalVirtualKeyInputSchema = z
  .object({
    userId: z.string().min(1),
    organizationId: z.string().min(1),
    virtualKeyId: z.string().min(1),
  })
  .strict();
export type RevokePersonalVirtualKeyInput = z.infer<
  typeof revokePersonalVirtualKeyInputSchema
>;

export const revokeAllPersonalVirtualKeysInputSchema = z
  .object({
    userId: z.string().min(1),
    actorUserId: z.string().min(1),
  })
  .strict();
export type RevokeAllPersonalVirtualKeysInput = z.infer<
  typeof revokeAllPersonalVirtualKeysInputSchema
>;

export class PersonalVirtualKeyAlreadyExistsError extends Error {
  constructor(readonly virtualKeyId: string) {
    super(
      `User already has a default personal VK (${virtualKeyId}); use issue() with a custom label for additional keys`,
    );
    this.name = "PersonalVirtualKeyAlreadyExistsError";
  }
}

export class PersonalVirtualKeyNotFoundError extends Error {
  constructor(readonly virtualKeyId: string) {
    super(`Personal virtual key ${virtualKeyId} not found or not owned by caller`);
    this.name = "PersonalVirtualKeyNotFoundError";
  }
}

export class NoEligibleProvidersError extends Error {
  constructor(readonly organizationId: string) {
    super(
      "Your organization has no AI providers configured. Ask an admin to add one at Settings → Model Providers.",
    );
    this.name = "NoEligibleProvidersError";
  }
}

export class RoutingPolicyHasNoProvidersError extends Error {
  constructor(
    readonly routingPolicyId: string,
    readonly routingPolicyName: string,
  ) {
    super(
      `Routing policy "${routingPolicyName}" has no providers configured. Ask your organization admin to add at least one provider in Settings → Routing Policies before issuing keys.`,
    );
    this.name = "RoutingPolicyHasNoProvidersError";
  }
}
