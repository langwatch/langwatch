// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Every served `ingestionSources.*` procedure, declared once, at main's wire names. */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import { governanceIngestionSourceTypeSchema } from "./ingestion-source.commands.ts";
import {
  ingestionSourceDtoSchema,
  ingestionSourceWithSecretSchema,
  ottlStarterTemplateSchema,
} from "./ingestion-source.ts";

const organizationScope = z.object({ organizationId: z.string() });
const sourceInOrganization = z.object({ ...organizationScope.shape, id: z.string() });

export const ingestionSourceCreateInputSchema = z.object({
  ...organizationScope.shape,
  teamId: z.string().nullable().optional(),
  sourceType: governanceIngestionSourceTypeSchema,
  name: z.string().min(1).max(128),
  description: z.string().nullable().optional(),
  parserConfig: z.record(z.string(), z.unknown()).optional(),
  pullConfig: z.record(z.string(), z.unknown()).nullable().optional(),
  pullSchedule: z.string().min(1).max(64).nullable().optional(),
  traceProjectId: z.string().min(1).nullable().optional(),
});
export type IngestionSourceCreateInput = z.infer<typeof ingestionSourceCreateInputSchema>;

export const ingestionSourceUpdateInputSchema = z.object({
  ...sourceInOrganization.shape,
  name: z.string().min(1).max(128).optional(),
  description: z.string().nullable().optional(),
  parserConfig: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(["active", "disabled", "awaiting_first_event"]).optional(),
  teamId: z.string().nullable().optional(),
  pullSchedule: z.string().min(1).max(64).nullable().optional(),
  traceProjectId: z.string().min(1).nullable().optional(),
});
export type IngestionSourceUpdateInput = z.infer<typeof ingestionSourceUpdateInputSchema>;

/** A create answers the secret once; a pull source has none, so it is null. */
export const createdIngestionSourceSchema = z
  .object({ source: ingestionSourceDtoSchema, ingestSecret: z.string().nullable() })
  .strict();

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

  .mutation("rotateSecret")
  .withInput(sourceInOrganization)
  .withOutput(ingestionSourceWithSecretSchema)

  .mutation("archive")
  .withInput(sourceInOrganization)
  .withOutput(ingestionSourceDtoSchema)

  .query("ottlStarter")
  .withInput(z.object({ ...organizationScope.shape, sourceType: z.string() }))
  .withOutput(ottlStarterTemplateSchema)
  .build();
