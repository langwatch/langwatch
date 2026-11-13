// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The registry as an Agentic Resource Discovery (ARD v0.91) manifest and its search. Only the
 * terms the spec names are used: identifier, displayName, type, data, description, tags,
 * capabilities, version, updatedAt, metadata. Spec: specs/agent-registry.feature
 */
import type { Named } from "@langwatch/module";
import { z } from "zod";

import { agentRegistryEntrySchema } from "./agent-registry.ts";

export const ARD_SPEC_VERSION = "0.91" as const;
export const ARD_CONTEXT = "https://agenticresourcediscovery.org/context/v1" as const;
export const ARD_AGENT_CARD_MEDIA_TYPE = "application/agent-card+json" as const;

const ardEntrySchemaDefinition = z.object({
  "@context": z.literal(ARD_CONTEXT),
  identifier: z.string(),
  displayName: z.string(),
  type: z.literal(ARD_AGENT_CARD_MEDIA_TYPE),
  description: z.string().optional(),
  version: z.string(),
  updatedAt: z.string(),
  tags: z.string().array(),
  capabilities: z.string().array(),
  /** The agent card inline: the registry entry itself. */
  data: agentRegistryEntrySchema,
  metadata: z.record(z.string(), z.string()),
});
export interface ArdEntrySchema extends Named<typeof ardEntrySchemaDefinition> {}
export const ardEntrySchema: ArdEntrySchema = ardEntrySchemaDefinition;
export type ArdEntry = z.infer<typeof ardEntrySchema>;

const ardManifestSchemaDefinition = z.object({
  specVersion: z.literal(ARD_SPEC_VERSION),
  publisher: z.string(),
  updatedAt: z.string(),
  entries: ardEntrySchema.array(),
});
export interface ArdManifestSchema extends Named<typeof ardManifestSchemaDefinition> {}
export const ardManifestSchema: ArdManifestSchema = ardManifestSchemaDefinition;
export type ArdManifest = z.infer<typeof ardManifestSchema>;

const ardSearchRequestSchemaDefinition = z.object({
  query: z.object({
    text: z.string().trim().min(1),
    /** Term path to accepted values: values OR-ed within a key, keys AND-ed; a bare value is one. */
    filter: z.record(z.string(), z.union([z.string(), z.string().array()])).optional(),
  }),
  federation: z.enum(["auto", "referrals", "none"]).optional(),
  pageSize: z.number().int().min(1).max(100).default(10),
  pageToken: z.string().regex(/^\d+$/).optional(),
});
export interface ArdSearchRequestSchema extends Named<typeof ardSearchRequestSchemaDefinition> {}
export const ardSearchRequestSchema: ArdSearchRequestSchema = ardSearchRequestSchemaDefinition;
export type ArdSearchRequest = z.infer<typeof ardSearchRequestSchema>;

const ardSearchResponseSchemaDefinition = z.object({
  results: z
    .object({
      ...ardEntrySchema.shape,
      score: z.number().min(0).max(100),
      /** The registry the result came from: its manifest URL. */
      source: z.string(),
    })
    .array(),
  pageToken: z.string().optional(),
});
export interface ArdSearchResponseSchema extends Named<typeof ardSearchResponseSchemaDefinition> {}
export const ardSearchResponseSchema: ArdSearchResponseSchema = ardSearchResponseSchemaDefinition;
export type ArdSearchResponse = z.infer<typeof ardSearchResponseSchema>;
