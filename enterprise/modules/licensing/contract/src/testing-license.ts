import type { Named } from "@langwatch/module";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Testing licences issued on Cloud (ADR-180 sections 1 and 2): who may ask, what is asked,
 * and the tokens that can do nothing else. A token itself crosses once, when it is minted.
 * @see specs/self-hosting/connected-services/testing-licenses.feature
 */
import { z } from "zod";

/** A label for the ops screen: from the CLI sign-in, or made for CI. Both act as their maker. */
export const testingLicenseTokenKindSchema = z.enum(["personal", "service"]);
export type TestingLicenseTokenKind = z.infer<typeof testingLicenseTokenKindSchema>;

/** Who asked, as the door verified the bearer: always the person the token acts as. */
const testingLicenseIssuerSchemaDefinition = z.object({
  kind: testingLicenseTokenKindSchema,
  tokenId: z.string(),
  /** The person the token belongs to and acts as. */
  userId: z.string(),
});
export interface TestingLicenseIssuerSchema extends Named<
  typeof testingLicenseIssuerSchemaDefinition
> {}
export const testingLicenseIssuerSchema: TestingLicenseIssuerSchema =
  testingLicenseIssuerSchemaDefinition;
export type TestingLicenseIssuer = z.infer<typeof testingLicenseIssuerSchema>;

/** What a developer's stack or a CI job asks for: one local organization on one instance. */
const issueTestingLicenseRequestSchemaDefinition = z.object({
  instanceId: z.string().min(1).max(128),
  /** The local organization on that instance, never a Cloud organization. */
  organizationId: z.string().min(1).max(128),
  /** How long it lasts; 5 days when absent, refused past 30 days. */
  lifetimeHours: z.number().int().positive().optional(),
});
export interface IssueTestingLicenseRequestSchema extends Named<
  typeof issueTestingLicenseRequestSchemaDefinition
> {}
export const issueTestingLicenseRequestSchema: IssueTestingLicenseRequestSchema =
  issueTestingLicenseRequestSchemaDefinition;
export type IssueTestingLicenseRequest = z.infer<typeof issueTestingLicenseRequestSchema>;

/** The signed licence, handed over once, and the registry row that records it. */
const issuedTestingLicenseSchemaDefinition = z.object({
  licenseKey: z.string(),
  issuedLicenseId: z.string(),
  /** ISO 8601. */
  expiresAt: z.string(),
});
export interface IssuedTestingLicenseSchema extends Named<
  typeof issuedTestingLicenseSchemaDefinition
> {}
export const issuedTestingLicenseSchema: IssuedTestingLicenseSchema =
  issuedTestingLicenseSchemaDefinition;
export type IssuedTestingLicense = z.infer<typeof issuedTestingLicenseSchema>;

export const testingLicenseTokenStatusSchema = z.enum(["active", "expired", "revoked"]);
export type TestingLicenseTokenStatus = z.infer<typeof testingLicenseTokenStatusSchema>;

/** A token as an ops manager reads it: never the token, never its hash. */
const testingLicenseTokenViewSchemaDefinition = z.object({
  id: z.string(),
  kind: testingLicenseTokenKindSchema,
  /** A service token's name; null on a personal token. */
  name: z.string().nullable(),
  /** The person who made the token and whom it acts as. */
  ownerUserId: z.string(),
  expiresAt: z.string(),
  revokedAt: z.string().nullable(),
  revokedById: z.string().nullable(),
  /** When it last issued a testing licence. */
  lastUsedAt: z.string().nullable(),
  createdAt: z.string(),
  status: testingLicenseTokenStatusSchema,
});
export interface TestingLicenseTokenViewSchema extends Named<
  typeof testingLicenseTokenViewSchemaDefinition
> {}
export const testingLicenseTokenViewSchema: TestingLicenseTokenViewSchema =
  testingLicenseTokenViewSchemaDefinition;
export type TestingLicenseTokenView = z.infer<typeof testingLicenseTokenViewSchema>;

const testingLicenseTokenPageSchemaDefinition = z.object({
  tokens: z.array(testingLicenseTokenViewSchema),
  total: z.number(),
});
export interface TestingLicenseTokenPageSchema extends Named<
  typeof testingLicenseTokenPageSchemaDefinition
> {}
export const testingLicenseTokenPageSchema: TestingLicenseTokenPageSchema =
  testingLicenseTokenPageSchemaDefinition;
export type TestingLicenseTokenPage = z.infer<typeof testingLicenseTokenPageSchema>;

const listTestingLicenseTokensInputSchemaDefinition = z.object({
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(1).max(100).default(50),
});
export interface ListTestingLicenseTokensInputSchema extends Named<
  typeof listTestingLicenseTokensInputSchemaDefinition
> {}
export const listTestingLicenseTokensInputSchema: ListTestingLicenseTokensInputSchema =
  listTestingLicenseTokensInputSchemaDefinition;

/** A CI token: named, expiring in 90 days unless asked otherwise, refused past a year. */
const createTestingLicenseServiceTokenInputSchemaDefinition = z.object({
  name: z.string().trim().min(1).max(100),
  expiresInDays: z.number().int().positive().optional(),
});
export interface CreateTestingLicenseServiceTokenInputSchema extends Named<
  typeof createTestingLicenseServiceTokenInputSchemaDefinition
> {}
export const createTestingLicenseServiceTokenInputSchema: CreateTestingLicenseServiceTokenInputSchema =
  createTestingLicenseServiceTokenInputSchemaDefinition;
export type CreateTestingLicenseServiceTokenInput = z.infer<
  typeof createTestingLicenseServiceTokenInputSchema
>;

/** A freshly minted token, shown once, beside what the list will show of it. */
const mintedTestingLicenseTokenSchemaDefinition = z.object({
  token: z.string(),
  testingLicenseToken: testingLicenseTokenViewSchema,
});
export interface MintedTestingLicenseTokenSchema extends Named<
  typeof mintedTestingLicenseTokenSchemaDefinition
> {}
export const mintedTestingLicenseTokenSchema: MintedTestingLicenseTokenSchema =
  mintedTestingLicenseTokenSchemaDefinition;
export type MintedTestingLicenseToken = z.infer<typeof mintedTestingLicenseTokenSchema>;

const revokeTestingLicenseTokenInputSchemaDefinition = z.object({ id: z.string().min(1) });
export interface RevokeTestingLicenseTokenInputSchema extends Named<
  typeof revokeTestingLicenseTokenInputSchemaDefinition
> {}
export const revokeTestingLicenseTokenInputSchema: RevokeTestingLicenseTokenInputSchema =
  revokeTestingLicenseTokenInputSchemaDefinition;
