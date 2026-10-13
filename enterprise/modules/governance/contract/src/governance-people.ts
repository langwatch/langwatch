// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Every `governancePeople.*` procedure, declared once, at main's wire names. */
import { defineTrpcContract, type Named } from "@langwatch/module";
import { z } from "zod";

const organizationScope = z.object({ organizationId: z.string() });

const peopleScreenPersonSchemaDefinition = z.object({
  id: z.string(),
  provider: z.string(),
  kind: z.string(),
  displayText: z.string(),
  rawActorId: z.string(),
  directoryDepartment: z.string().nullable(),
  firstSeenAt: z.date(),
  lastSeenAt: z.date(),
  erasedAt: z.date().nullable(),
  suspendedAt: z.date().nullable(),
  suspendedReason: z.string().nullable(),
  link: z
    .object({
      userId: z.string(),
      evidenceKind: z.string(),
      memberName: z.string().nullable(),
      departmentName: z.string().nullable(),
    })
    .nullable(),
});
export interface PeopleScreenPersonSchema extends Named<
  typeof peopleScreenPersonSchemaDefinition
> {}
export const peopleScreenPersonSchema: PeopleScreenPersonSchema =
  peopleScreenPersonSchemaDefinition;
export type PeopleScreenPerson = z.infer<typeof peopleScreenPersonSchema>;

const peopleScreenSuggestionSchemaDefinition = z.object({
  id: z.string(),
  discoveredPersonId: z.string(),
  personDisplayText: z.string(),
  personProvider: z.string(),
  userId: z.string(),
  memberName: z.string().nullable(),
  score: z.number(),
});
export interface PeopleScreenSuggestionSchema extends Named<
  typeof peopleScreenSuggestionSchemaDefinition
> {}
export const peopleScreenSuggestionSchema: PeopleScreenSuggestionSchema =
  peopleScreenSuggestionSchemaDefinition;
export type PeopleScreenSuggestion = z.infer<typeof peopleScreenSuggestionSchema>;

const identityMatchRunSchemaDefinition = z.object({
  linked: z.number().int().nonnegative(),
  suspended: z.number().int().nonnegative(),
  unproven: z.number().int().nonnegative(),
});
export interface IdentityMatchRunSchema extends Named<typeof identityMatchRunSchemaDefinition> {}
export const identityMatchRunSchema: IdentityMatchRunSchema = identityMatchRunSchemaDefinition;
export type IdentityMatchRun = z.infer<typeof identityMatchRunSchema>;

const identityMatchConfirmedSchemaDefinition = z.object({
  discoveredPersonId: z.string(),
  userId: z.string(),
});
export interface IdentityMatchConfirmedSchema extends Named<
  typeof identityMatchConfirmedSchemaDefinition
> {}
export const identityMatchConfirmedSchema: IdentityMatchConfirmedSchema =
  identityMatchConfirmedSchemaDefinition;
export type IdentityMatchConfirmed = z.infer<typeof identityMatchConfirmedSchema>;

export const governancePeopleTrpc = defineTrpcContract("governancePeople")
  .query("list")
  .withInput(organizationScope)
  .withOutput(peopleScreenPersonSchema.array())

  .query("suggestions")
  .withInput(organizationScope)
  .withOutput(peopleScreenSuggestionSchema.array())

  .mutation("runMatch")
  .withInput(organizationScope)
  .withOutput(identityMatchRunSchema)

  .mutation("confirmSuggestion")
  .withInput(z.object({ organizationId: z.string(), suggestionId: z.string() }))
  .withOutput(identityMatchConfirmedSchema)
  .build();
