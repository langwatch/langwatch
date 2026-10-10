import type { Named } from "@langwatch/module";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { z } from "zod";

const personalVirtualKeyScopeSchemaDefinition = z
  .object({
    scopeType: z.enum(["ORGANIZATION", "TEAM", "PROJECT"]),
    scopeId: z.string().min(1),
  })
  .strict();
export interface PersonalVirtualKeyScopeSchema extends Named<
  typeof personalVirtualKeyScopeSchemaDefinition
> {}
export const personalVirtualKeyScopeSchema: PersonalVirtualKeyScopeSchema =
  personalVirtualKeyScopeSchemaDefinition;

const personalVirtualKeySchemaDefinition = z
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
export interface PersonalVirtualKeySchema extends Named<
  typeof personalVirtualKeySchemaDefinition
> {}
export const personalVirtualKeySchema: PersonalVirtualKeySchema =
  personalVirtualKeySchemaDefinition;
export type PersonalVirtualKey = z.infer<typeof personalVirtualKeySchema>;

const issuedPersonalVirtualKeySchemaDefinition = z
  .object({
    virtualKey: personalVirtualKeySchema,
    secret: z.string().min(1),
    baseUrl: z.string().url(),
    routingPolicyId: z.string().nullable(),
    id: z.string().min(1),
    label: z.string().min(1),
  })
  .strict();
export interface IssuedPersonalVirtualKeySchema extends Named<
  typeof issuedPersonalVirtualKeySchemaDefinition
> {}
export const issuedPersonalVirtualKeySchema: IssuedPersonalVirtualKeySchema =
  issuedPersonalVirtualKeySchemaDefinition;
export type IssuedPersonalVirtualKey = z.infer<typeof issuedPersonalVirtualKeySchema>;

/**
 * What issuing a personal key answers: the one moment the plaintext secret
 * exists on the wire. Nothing stores it and no read returns it again, so a
 * caller who loses it revokes and issues another.
 */
const issuedPersonalVirtualKeyAnswerSchemaDefinition = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    secret: z.string().min(1),
    baseUrl: z.string().url(),
    displayPrefix: personalVirtualKeySchema.shape.displayPrefix,
    routingPolicyId: z.string().nullable(),
  })
  .strict();
export interface IssuedPersonalVirtualKeyAnswerSchema extends Named<
  typeof issuedPersonalVirtualKeyAnswerSchemaDefinition
> {}
export const issuedPersonalVirtualKeyAnswerSchema: IssuedPersonalVirtualKeyAnswerSchema =
  issuedPersonalVirtualKeyAnswerSchemaDefinition;
export type IssuedPersonalVirtualKeyAnswer = z.infer<typeof issuedPersonalVirtualKeyAnswerSchema>;

const ensureDefaultPersonalVirtualKeyInputSchemaDefinition = z
  .object({
    userId: z.string().min(1),
    organizationId: z.string().min(1),
    displayName: z.string().nullable().optional(),
    displayEmail: z.string().nullable().optional(),
  })
  .strict();
export interface EnsureDefaultPersonalVirtualKeyInputSchema extends Named<
  typeof ensureDefaultPersonalVirtualKeyInputSchemaDefinition
> {}
export const ensureDefaultPersonalVirtualKeyInputSchema: EnsureDefaultPersonalVirtualKeyInputSchema =
  ensureDefaultPersonalVirtualKeyInputSchemaDefinition;
export type EnsureDefaultPersonalVirtualKeyInput = z.infer<
  typeof ensureDefaultPersonalVirtualKeyInputSchema
>;

const issuePersonalVirtualKeyInputSchemaDefinition = z
  .object({
    userId: z.string().min(1),
    organizationId: z.string().min(1),
    personalProjectId: z.string().min(1),
    personalTeamId: z.string().min(1).optional(),
    label: z.string().min(1),
    routingPolicyId: z.string().nullable().optional(),
  })
  .strict();
export interface IssuePersonalVirtualKeyInputSchema extends Named<
  typeof issuePersonalVirtualKeyInputSchemaDefinition
> {}
export const issuePersonalVirtualKeyInputSchema: IssuePersonalVirtualKeyInputSchema =
  issuePersonalVirtualKeyInputSchemaDefinition;
export type IssuePersonalVirtualKeyInput = z.infer<typeof issuePersonalVirtualKeyInputSchema>;

const listPersonalVirtualKeysInputSchemaDefinition = z
  .object({
    organizationId: z.string().min(1),
    userId: z.string().min(1).optional(),
  })
  .strict();
export interface ListPersonalVirtualKeysInputSchema extends Named<
  typeof listPersonalVirtualKeysInputSchemaDefinition
> {}
export const listPersonalVirtualKeysInputSchema: ListPersonalVirtualKeysInputSchema =
  listPersonalVirtualKeysInputSchemaDefinition;
export type ListPersonalVirtualKeysInput = z.infer<typeof listPersonalVirtualKeysInputSchema>;

const revokePersonalVirtualKeyInputSchemaDefinition = z
  .object({
    userId: z.string().min(1),
    organizationId: z.string().min(1),
    virtualKeyId: z.string().min(1),
  })
  .strict();
export interface RevokePersonalVirtualKeyInputSchema extends Named<
  typeof revokePersonalVirtualKeyInputSchemaDefinition
> {}
export const revokePersonalVirtualKeyInputSchema: RevokePersonalVirtualKeyInputSchema =
  revokePersonalVirtualKeyInputSchemaDefinition;
export type RevokePersonalVirtualKeyInput = z.infer<typeof revokePersonalVirtualKeyInputSchema>;

const revokeAllPersonalVirtualKeysInputSchemaDefinition = z
  .object({
    userId: z.string().min(1),
    actorUserId: z.string().min(1),
  })
  .strict();
export interface RevokeAllPersonalVirtualKeysInputSchema extends Named<
  typeof revokeAllPersonalVirtualKeysInputSchemaDefinition
> {}
export const revokeAllPersonalVirtualKeysInputSchema: RevokeAllPersonalVirtualKeysInputSchema =
  revokeAllPersonalVirtualKeysInputSchemaDefinition;
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
