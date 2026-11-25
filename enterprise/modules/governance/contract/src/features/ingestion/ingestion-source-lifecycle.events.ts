// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Governance's facts about an ingestion source's lifecycle: it was created, and its first data
 * arrived. Nurturing reacts to them from its own side, so it never reads governance's tables.
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 */
import type { Named } from "@langwatch/module";
import { z } from "zod";

export const INGESTION_SOURCE_LIFECYCLE_PIPELINE_NAME = "governance_ingestion_source" as const;
export const INGESTION_SOURCE_LIFECYCLE_AGGREGATE_TYPE = "governance_ingestion_source" as const;
export const INGESTION_SOURCE_CREATED_EVENT_TYPE =
  "lw.governance.ingestion_source_created" as const;
export const INGESTION_SOURCE_WENT_LIVE_EVENT_TYPE =
  "lw.governance.ingestion_source_went_live" as const;
export const INGESTION_SOURCE_LIFECYCLE_EVENT_VERSION = "2026-11-24" as const;
export const INGESTION_SOURCE_LIFECYCLE_COMMAND_TYPES = {
  RECORD_CREATED: "lw.governance.record_ingestion_source_created",
  RECORD_WENT_LIVE: "lw.governance.record_ingestion_source_went_live",
} as const;

/** One source's fact, the same shape for both: who made it and what kind of source it is. */
const ingestionSourceFactDataSchemaDefinition = z.object({
  /** The organization: an ingestion source belongs to no project. */
  tenantId: z.string().min(1),
  organizationId: z.string().min(1),
  sourceId: z.string().min(1),
  sourceType: z.string().min(1),
  /** The person who created the source; null when no person did. */
  actorUserId: z.string().min(1).nullable(),
  /** Unix ms of the create, or of the stamp that saw the first data. */
  occurredAt: z.number().int().nonnegative(),
});
export interface IngestionSourceFactDataSchema extends Named<
  typeof ingestionSourceFactDataSchemaDefinition
> {}
export const ingestionSourceFactDataSchema: IngestionSourceFactDataSchema =
  ingestionSourceFactDataSchemaDefinition;
export type IngestionSourceFactData = z.infer<typeof ingestionSourceFactDataSchema>;
