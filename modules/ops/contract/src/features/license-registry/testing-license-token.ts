import type { Named } from "@langwatch/module";
/** The testing-licence tokens (ADR-180 section 2). `licensing` is an enterprise module, so
 * every shape here is declared locally rather than imported from it. */
import { z } from "zod";

const testingLicenseTokenKindSchema = z.enum(["personal", "service"]);

const testingLicenseTokenStatusSchema = z.enum(["active", "expired", "revoked"]);

/** A token as an ops manager reads it: never the token, never its hash. */
const testingLicenseTokenViewSchemaDefinition = z.object({
  id: z.string(),
  kind: testingLicenseTokenKindSchema,
  name: z.string().nullable(),
  /** The person who made the token and whom it acts as. */
  ownerUserId: z.string(),
  /** The owner's name; null when that person is gone. */
  ownerName: z.string().nullable().optional(),
  expiresAt: z.string(),
  revokedAt: z.string().nullable(),
  revokedById: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  createdAt: z.string(),
  status: testingLicenseTokenStatusSchema,
});
export interface TestingLicenseTokenViewSchema extends Named<
  typeof testingLicenseTokenViewSchemaDefinition
> {}
export const testingLicenseTokenViewSchema: TestingLicenseTokenViewSchema =
  testingLicenseTokenViewSchemaDefinition;

const testingLicenseTokenPageSchemaDefinition = z.object({
  tokens: z.array(testingLicenseTokenViewSchema),
  total: z.number(),
});
export interface TestingLicenseTokenPageSchema extends Named<
  typeof testingLicenseTokenPageSchemaDefinition
> {}
export const testingLicenseTokenPageSchema: TestingLicenseTokenPageSchema =
  testingLicenseTokenPageSchemaDefinition;

const listTestingLicenseTokensInputSchemaDefinition = z.object({
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(1).max(100).default(50),
});
export interface ListTestingLicenseTokensInputSchema extends Named<
  typeof listTestingLicenseTokensInputSchemaDefinition
> {}
export const listTestingLicenseTokensInputSchema: ListTestingLicenseTokensInputSchema =
  listTestingLicenseTokensInputSchemaDefinition;

const createTestingLicenseServiceTokenInputSchemaDefinition = z.object({
  name: z.string().trim().min(1).max(100),
  expiresInDays: z.number().int().positive().optional(),
});
export interface CreateTestingLicenseServiceTokenInputSchema extends Named<
  typeof createTestingLicenseServiceTokenInputSchemaDefinition
> {}
export const createTestingLicenseServiceTokenInputSchema: CreateTestingLicenseServiceTokenInputSchema =
  createTestingLicenseServiceTokenInputSchemaDefinition;

/** A freshly minted service token, shown once. */
const mintedTestingLicenseTokenSchemaDefinition = z.object({
  token: z.string(),
  testingLicenseToken: testingLicenseTokenViewSchema,
});
export interface MintedTestingLicenseTokenSchema extends Named<
  typeof mintedTestingLicenseTokenSchemaDefinition
> {}
export const mintedTestingLicenseTokenSchema: MintedTestingLicenseTokenSchema =
  mintedTestingLicenseTokenSchemaDefinition;

const revokeTestingLicenseTokenInputSchemaDefinition = z.object({ id: z.string().min(1) });
export interface RevokeTestingLicenseTokenInputSchema extends Named<
  typeof revokeTestingLicenseTokenInputSchemaDefinition
> {}
export const revokeTestingLicenseTokenInputSchema: RevokeTestingLicenseTokenInputSchema =
  revokeTestingLicenseTokenInputSchemaDefinition;
