// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  AGENT_REGISTRY_ARD_ENTRY_LIMIT,
  type AgentRegistryEntry,
  type AgentRegistryEventPage,
  type AgentRegistryPage,
  type AgentRegistryStatus,
  type ArdManifest,
  type ArdSearchRequest,
  type ArdSearchResponse,
  GovernanceValidationError,
} from "@langwatch/enterprise-governance-contract";
import { Temporal, type Instant } from "@langwatch/time";
import { z } from "zod";

import type {
  AgentRegistryRepository,
  RegistryEntryPosition,
} from "../../../repositories/agent-registry.repository.ts";
import { ardManifestOf, ardPublisherOf, ardSearch } from "../rules/registry-ard.rules.ts";
import { registryTimestamp } from "../rules/registry-reconcile.rules.ts";

const entryCursorSchema = z.object({ u: z.iso.datetime({ offset: true }), i: z.string().min(1) });

function encodeCursor(position: RegistryEntryPosition): string {
  return Buffer.from(JSON.stringify({ u: position.updatedAt, i: position.id })).toString(
    "base64url",
  );
}

function decodeCursor(cursor: string): RegistryEntryPosition {
  try {
    const parsed = entryCursorSchema.parse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
    );
    return { updatedAt: parsed.u, id: parsed.i };
  } catch {
    throw new GovernanceValidationError("The cursor is not one this listing returned.", {
      formErrors: ["cursor is invalid"],
    });
  }
}

type AgentRegistryReadsDependencies = {
  registry: AgentRegistryRepository;
  publicBaseUrl: string;
  now: () => Instant;
};

/**
 * The registry as readers see it: paged entries, versions, the change feed, the ARD manifest and
 * search. Spec: enterprise/modules/governance/specs/agent-registry.feature
 */
export class AgentRegistryReadsService {
  private constructor(private readonly deps: AgentRegistryReadsDependencies) {}

  static create(deps: AgentRegistryReadsDependencies): AgentRegistryReadsService {
    return new AgentRegistryReadsService(deps);
  }

  async listEntries({
    organizationId,
    limit,
    cursor,
    updatedSince,
    status,
  }: {
    organizationId: string;
    limit: number;
    cursor?: string;
    updatedSince?: string;
    status?: AgentRegistryStatus;
  }): Promise<AgentRegistryPage> {
    const { entries, hasMore } = await this.deps.registry.listEntries({
      organizationId,
      limit,
      ...(cursor ? { after: decodeCursor(cursor) } : {}),
      ...(updatedSince ? { updatedSince: Temporal.Instant.from(updatedSince) } : {}),
      ...(status ? { status } : {}),
    });
    const last = entries.at(-1);
    return {
      data: entries,
      next_cursor:
        hasMore && last ? encodeCursor({ updatedAt: last.updated_at, id: last.id }) : null,
    };
  }

  getEntry(input: { organizationId: string; id: string }): Promise<AgentRegistryEntry> {
    return this.deps.registry.getEntry(input);
  }

  async listVersions({
    organizationId,
    id,
    cursor,
    limit,
  }: {
    organizationId: string;
    id: string;
    cursor?: string;
    limit: number;
  }): Promise<AgentRegistryEventPage> {
    await this.deps.registry.getEntry({ organizationId, id });
    const events = await this.deps.registry.findEventsOfEntry({
      organizationId,
      entryId: id,
      ...(cursor ? { after: BigInt(cursor) } : {}),
      limit,
    });
    return {
      data: events,
      next_cursor: events.length === limit ? (events.at(-1)?.sequence ?? null) : null,
    };
  }

  async listEvents({
    organizationId,
    cursor,
    limit,
  }: {
    organizationId: string;
    cursor?: string;
    limit: number;
  }): Promise<AgentRegistryEventPage> {
    const events = await this.deps.registry.findEventsAfter({
      organizationId,
      ...(cursor ? { after: BigInt(cursor) } : {}),
      limit,
    });
    return {
      data: events,
      next_cursor: events.length === limit ? (events.at(-1)?.sequence ?? null) : null,
    };
  }

  async ardManifest({ organizationId }: { organizationId: string }): Promise<ArdManifest> {
    const entries = await this.deps.registry.findEntries({
      organizationId,
      status: "active",
      limit: AGENT_REGISTRY_ARD_ENTRY_LIMIT,
    });
    const updatedAt =
      entries
        .map((entry) => entry.updated_at)
        .toSorted()
        .at(-1) ?? registryTimestamp(this.deps.now());
    return ardManifestOf({
      entries,
      publisher: ardPublisherOf(this.deps.publicBaseUrl),
      organizationId,
      updatedAt,
    });
  }

  async ardSearch({
    organizationId,
    request,
  }: {
    organizationId: string;
    request: ArdSearchRequest;
  }): Promise<ArdSearchResponse> {
    return ardSearch({
      manifest: await this.ardManifest({ organizationId }),
      request,
      source: `${this.deps.publicBaseUrl.replace(/\/+$/, "")}/api/governance/registry/ard.json`,
    });
  }
}
