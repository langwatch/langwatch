// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The entries of an Agentic Resource Discovery (ARD v0.91) registry as agent sightings. Read
 * loosely: another registry may leave out what ours always writes, but every field it does send
 * must have the type our own contract gives it. Pure; the HTTP walk lives in the ARD channel.
 * Spec: enterprise/modules/governance/specs/cloud-agent-discovery.feature
 */

import { ARD_SPEC_VERSION } from "@langwatch/enterprise-governance-contract";
import { z } from "zod";

import type { DiscoveredAgentRecord } from "./agent-listing.rules.ts";
import { definedMetadata, isoMomentText } from "./cloud-agent-metadata.rules.ts";

export const ARD_AIR_PREFIX = "urn:air:";
export const ARD_MANIFEST_PATH = "/.well-known/ard.json";

export const ardListedEntrySchema = z.object({
  identifier: z.string().min(1),
  displayName: z.string().optional(),
  type: z.string().optional(),
  description: z.string().optional(),
  version: z.string().optional(),
  updatedAt: z.string().optional(),
  tags: z.string().array().optional(),
  capabilities: z.string().array().optional(),
  data: z.unknown().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type ArdListedEntry = z.infer<typeof ardListedEntrySchema>;

export const ardListedManifestSchema = z.object({
  specVersion: z.string(),
  entries: ardListedEntrySchema.array(),
});

export const ardListedSearchPageSchema = z.object({
  results: ardListedEntrySchema.array(),
  pageToken: z.string().optional(),
});

export function isSupportedArdVersion(specVersion: string): boolean {
  return specVersion === ARD_SPEC_VERSION;
}

/** The manifest address of a registry named by bare domain or by URL; refuses what is not http(s). */
export function ardManifestUrl({ registryUrl }: { registryUrl: string }): string {
  const trimmed = registryUrl.trim();
  const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new TypeError("an ARD registry is reached over http(s)");
  }
  return `${url.origin}${ARD_MANIFEST_PATH}`;
}

const inlineCardSchema = z.object({
  owner_label: z.string().optional(),
  model: z.object({ model: z.string().optional() }).nullable().optional(),
});

/** ARD tags as a label map: `key:value` and `key=value` split, a bare tag maps to "". */
function labelsOf({ tags }: { tags: string[] }): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const tag of tags) {
    const match = /^([^:=]+)[:=](.*)$/.exec(tag);
    if (match?.[1]) labels[match[1]] = match[2] ?? "";
    else labels[tag] = "";
  }
  return labels;
}

/** One urn:air entry as the sighting `DiscoveredAgent` stores. */
export function ardEntryAsAgent({ entry }: { entry: ArdListedEntry }): DiscoveredAgentRecord {
  const card = inlineCardSchema.safeParse(entry.data);
  const cardOwner = card.success ? card.data.owner_label : undefined;
  const metadataOwner = entry.metadata?.owner;
  const metadata = definedMetadata({
    platform: "ard",
    owner: typeof metadataOwner === "string" && metadataOwner ? metadataOwner : cardOwner,
    model: card.success ? card.data.model?.model : undefined,
    tags: JSON.stringify(labelsOf({ tags: entry.tags ?? [] })),
    version: entry.version,
    description: entry.description,
    updatedAt: isoMomentText({ value: entry.updatedAt }),
    matchIds: JSON.stringify([entry.identifier]),
  });
  return {
    rawAgentId: entry.identifier,
    displayText: entry.displayName?.trim() || entry.identifier,
    metadata,
  };
}

/** The urn:air entries of every page, the first occurrence of an identifier kept. */
export function ardEntriesAsAgents({
  entries,
}: {
  entries: ArdListedEntry[];
}): DiscoveredAgentRecord[] {
  const agents = new Map<string, DiscoveredAgentRecord>();
  for (const entry of entries) {
    if (!entry.identifier.startsWith(ARD_AIR_PREFIX) || agents.has(entry.identifier)) continue;
    agents.set(entry.identifier, ardEntryAsAgent({ entry }));
  }
  return [...agents.values()];
}
