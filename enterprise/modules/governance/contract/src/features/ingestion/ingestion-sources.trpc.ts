// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Every served `ingestionSources.*` procedure, declared once, at main's wire names. */
import { defineTrpcContract, type Named } from "@langwatch/module";
import { z } from "zod";

import {
  securityLakeCallersSchema,
  securityLakeConnectionTestInputSchema,
  securityLakeConnectionTestSchema,
  securityLakeSourceCreateInputSchema,
  securityLakeSourceHealthSchema,
  securityLakeSourceSchema,
  securityLakeSourceUpdateInputSchema,
} from "../ocsf/security-lake.ts";
import {
  governanceIngestionSourceTypeSchema,
  INGESTION_SOURCE_DESCRIPTION_MAX,
  INGESTION_SOURCE_NAME_MAX,
} from "./ingestion-source.commands.ts";
import {
  ingestionSourceDtoSchema,
  ingestionSourceWithSecretSchema,
  ottlStarterTemplateSchema,
} from "./ingestion-source.ts";
import { ottlValidationResultSchema } from "./ottl.ts";

const organizationScope = z.object({ organizationId: z.string() });
const sourceInOrganization = z.object({ ...organizationScope.shape, id: z.string() });

const ingestionSourceCreateInputSchemaDefinition = z.object({
  ...organizationScope.shape,
  teamId: z.string().nullable().optional(),
  sourceType: governanceIngestionSourceTypeSchema,
  name: z.string().min(1).max(INGESTION_SOURCE_NAME_MAX),
  description: z.string().max(INGESTION_SOURCE_DESCRIPTION_MAX).nullable().optional(),
  parserConfig: z.record(z.string(), z.unknown()).optional(),
  pullConfig: z.record(z.string(), z.unknown()).nullable().optional(),
  pullSchedule: z.string().min(1).max(64).nullable().optional(),
  traceProjectId: z.string().min(1).nullable().optional(),
});
export interface IngestionSourceCreateInputSchema extends Named<
  typeof ingestionSourceCreateInputSchemaDefinition
> {}
export const ingestionSourceCreateInputSchema: IngestionSourceCreateInputSchema =
  ingestionSourceCreateInputSchemaDefinition;
export type IngestionSourceCreateInput = z.infer<typeof ingestionSourceCreateInputSchema>;

const ingestionSourceUpdateInputSchemaDefinition = z.object({
  ...sourceInOrganization.shape,
  name: z.string().min(1).max(INGESTION_SOURCE_NAME_MAX).optional(),
  description: z.string().max(INGESTION_SOURCE_DESCRIPTION_MAX).nullable().optional(),
  parserConfig: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(["active", "disabled", "awaiting_first_event"]).optional(),
  teamId: z.string().nullable().optional(),
  pullSchedule: z.string().min(1).max(64).nullable().optional(),
  traceProjectId: z.string().min(1).nullable().optional(),
});
export interface IngestionSourceUpdateInputSchema extends Named<
  typeof ingestionSourceUpdateInputSchemaDefinition
> {}
export const ingestionSourceUpdateInputSchema: IngestionSourceUpdateInputSchema =
  ingestionSourceUpdateInputSchemaDefinition;
export type IngestionSourceUpdateInput = z.infer<typeof ingestionSourceUpdateInputSchema>;

/** A create answers the secret once; a pull source has none, so it is null. */
const createdIngestionSourceSchemaDefinition = z
  .object({ source: ingestionSourceDtoSchema, ingestSecret: z.string().nullable() })
  .strict();
export interface CreatedIngestionSourceSchema extends Named<
  typeof createdIngestionSourceSchemaDefinition
> {}
export const createdIngestionSourceSchema: CreatedIngestionSourceSchema =
  createdIngestionSourceSchemaDefinition;

/** A source's configuration tried against its provider before (or after) it is saved. */
const testAgentListingInputSchemaDefinition = z.object({
  ...organizationScope.shape,
  sourceType: governanceIngestionSourceTypeSchema,
  config: z.record(z.string(), z.unknown()),
  credentials: z.record(z.string(), z.string()).optional(),
});
export interface TestAgentListingInputSchema extends Named<
  typeof testAgentListingInputSchemaDefinition
> {}
export const testAgentListingInputSchema: TestAgentListingInputSchema =
  testAgentListingInputSchemaDefinition;
export type TestAgentListingInput = z.infer<typeof testAgentListingInputSchema>;

/** What the provider answered, recorded nowhere. `reason` is a listing refusal code. */
const testAgentListingResultSchemaDefinition = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("listed"), agentCount: z.number().int().nonnegative() }),
  z.object({ outcome: z.literal("empty") }),
  z.object({
    outcome: z.literal("refused"),
    reason: z.string(),
    status: z.number().int().nullable(),
  }),
]);
export interface TestAgentListingResultSchema extends Named<
  typeof testAgentListingResultSchemaDefinition
> {}
export const testAgentListingResultSchema: TestAgentListingResultSchema =
  testAgentListingResultSchemaDefinition;
export type TestAgentListingResult = z.infer<typeof testAgentListingResultSchema>;

export const ingestionSourcesTrpc = defineTrpcContract("ingestionSources")
  .query("list")
  .withInput(organizationScope)
  .withOutput(ingestionSourceDtoSchema.array())

  .query("get")
  .withInput(sourceInOrganization)
  .withOutput(ingestionSourceDtoSchema)

  .mutation("create")
  .withInput(ingestionSourceCreateInputSchema)
  .withOutput(createdIngestionSourceSchema)

  .mutation("update")
  .withInput(ingestionSourceUpdateInputSchema)
  .withOutput(ingestionSourceDtoSchema)

  .mutation("securityLakeCreate")
  .withInput(z.object({ ...organizationScope.shape, ...securityLakeSourceCreateInputSchema.shape }))
  .withOutput(securityLakeSourceSchema)

  .mutation("securityLakeUpdate")
  .withInput(
    z.object({ ...sourceInOrganization.shape, ...securityLakeSourceUpdateInputSchema.shape }),
  )
  .withOutput(securityLakeSourceSchema)

  .query("securityLakeGet")
  .withInput(sourceInOrganization)
  .withOutput(securityLakeSourceSchema)

  .mutation("securityLakeTestConnection")
  .withInput(
    z.object({ ...sourceInOrganization.shape, ...securityLakeConnectionTestInputSchema.shape }),
  )
  .withOutput(securityLakeConnectionTestSchema)

  .query("securityLakeHealth")
  .withInput(sourceInOrganization)
  .withOutput(securityLakeSourceHealthSchema)

  .query("securityLakeCallersWithoutTraces")
  .withInput(organizationScope)
  .withOutput(securityLakeCallersSchema)

  .mutation("rotateSecret")
  .withInput(sourceInOrganization)
  .withOutput(ingestionSourceWithSecretSchema)

  .mutation("archive")
  .withInput(sourceInOrganization)
  .withOutput(ingestionSourceDtoSchema)

  .mutation("validateOttl")
  .withInput(
    z.object({ ...organizationScope.shape, statements: z.array(z.string()).min(0).max(64) }),
  )
  .withOutput(ottlValidationResultSchema)

  .query("ottlStarter")
  .withInput(z.object({ ...organizationScope.shape, sourceType: z.string() }))
  .withOutput(ottlStarterTemplateSchema)

  .mutation("testAgentListing")
  .withInput(testAgentListingInputSchema)
  .withOutput(testAgentListingResultSchema)

  .mutation("testAgentListingForSource")
  .withInput(z.object({ ...organizationScope.shape, sourceId: z.string().min(1) }))
  .withOutput(testAgentListingResultSchema)
  .build();
