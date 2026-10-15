// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Every `ingestionTemplates.*` procedure, declared once, at main's wire names. */
import { defineTrpcContract, type Named } from "@langwatch/module";
import { z } from "zod";

import { governanceWriteAcknowledgedSchema } from "../../governance.responses.ts";
import { ingestionTemplateSchema } from "./ingestion-template.ts";

const organizationScope = z.object({ organizationId: z.string() });
const templateInOrganization = z.object({ ...organizationScope.shape, id: z.string() });

const ingestionTemplateCreateSchemaDefinition = z.object({
  ...organizationScope.shape,
  sourceType: z.string(),
  displayName: z.string().min(1).max(80),
  description: z.string().max(2000).optional(),
  iconAsset: z.string().max(20_000).optional(),
  credentialSchema: z.enum(["otlp_token", "static_api_key", "agent_id"]).nullable().optional(),
  ottlRules: z.string().max(50_000).optional(),
});
export interface IngestionTemplateCreateSchema extends Named<
  typeof ingestionTemplateCreateSchemaDefinition
> {}
export const ingestionTemplateCreateSchema: IngestionTemplateCreateSchema =
  ingestionTemplateCreateSchemaDefinition;

export const ingestionTemplatesTrpc = defineTrpcContract("ingestionTemplates")
  .query("list")
  .withInput(organizationScope)
  .withOutput(ingestionTemplateSchema.array())

  .query("adminList")
  .withInput(organizationScope)
  .withOutput(ingestionTemplateSchema.array())

  .query("get")
  .withInput(templateInOrganization)
  .withOutput(ingestionTemplateSchema)

  .mutation("create")
  .withInput(ingestionTemplateCreateSchema)
  .withOutput(ingestionTemplateSchema)

  .mutation("updateOttlRules")
  .withInput(z.object({ ...templateInOrganization.shape, ottlRules: z.string().max(50_000) }))
  .withOutput(ingestionTemplateSchema)

  .mutation("archive")
  .withInput(templateInOrganization)
  .withOutput(governanceWriteAcknowledgedSchema)

  .mutation("cloneFromPlatform")
  .withInput(z.object({ ...organizationScope.shape, sourceTemplateId: z.string() }))
  .withOutput(ingestionTemplateSchema)
  .build();
