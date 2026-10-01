// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createApiFixture } from "@langwatch/api-fixture";
import type { ProjectApi } from "@langwatch/project-contract";
import { createTestLogger } from "@langwatch/test-harness";
import { describe, expect, it, vi } from "vitest";

import { MemoryIngestionSourceRepository } from "../../repositories/memory/memory.ingestion-source.repository.ts";
import type { AgentListingRequestCommand } from "../../rules/agent-listing-request.rules.ts";
import type { AgentsListingSummary } from "../../rules/agents-listing-outcome.rules.ts";
import { GovernanceAgentSyncService } from "../governance-agent-sync.service.ts";

type SourceType = Parameters<MemoryIngestionSourceRepository["create"]>[0]["sourceType"];

interface SeededSource {
  name: string;
  sourceType: SourceType;
  pullSchedule?: string | null;
  status?: "active" | "disabled";
  organizationId?: string;
}

interface ListingRow extends AgentsListingSummary {
  sourceId: string;
  projectId: string;
}

const GENIE: SeededSource = { name: "Prod Genie", sourceType: "databricks_genie" };
const COPILOT: SeededSource = { name: "Copilot tenant", sourceType: "copilot_studio_dataverse" };
const OTEL: SeededSource = { name: "Traces", sourceType: "otel_generic" };
const UNSCHEDULED_GENIE: SeededSource = { ...GENIE, name: "Staging Genie", pullSchedule: null };
const DISABLED_COPILOT: SeededSource = {
  ...COPILOT,
  name: "Old Copilot tenant",
  status: "disabled",
};

/** The listings fake APPLIES its tenant predicate, so the tenancy assertions can fail. */
async function buildWorld({
  sources,
  govProjectId = "gov-project-1",
  listings = () => [],
}: {
  sources: SeededSource[];
  govProjectId?: string | null;
  listings?: (ids: Map<string, string>) => ListingRow[];
}) {
  const repository = MemoryIngestionSourceRepository.create();
  const ids = new Map<string, string>();
  for (const seeded of sources) {
    const row = await repository.create({
      organizationId: seeded.organizationId ?? "org-1",
      teamId: null,
      traceProjectId: null,
      sourceType: seeded.sourceType,
      name: seeded.name,
      description: null,
      ingestSecretHash: `hash-${seeded.name}`,
      parserConfig: {},
      pullSchedule: seeded.pullSchedule === undefined ? "0 * * * *" : seeded.pullSchedule,
      status: "awaiting_first_event",
      createdById: "user-1",
      providerAccountId: null,
    });
    await repository.update(row.id, { status: seeded.status ?? "active" });
    ids.set(seeded.name, row.id);
  }
  const findInternal = vi.fn<ProjectApi["findInternal"]>(async ({ organizationId }) =>
    govProjectId && organizationId === "org-1"
      ? {
          id: govProjectId,
          name: "Governance",
          slug: "governance",
          teamId: "team-1",
          kind: "internal_governance",
          archivedAtMs: null,
          traceSharingEnabled: false,
        }
      : null,
  );
  const rows = listings(ids);
  const findAgentsListings = vi.fn(
    async ({ sourceIds, projectId }: { sourceIds: readonly string[]; projectId: string }) =>
      new Map(
        rows
          .filter((row) => row.projectId === projectId && sourceIds.includes(row.sourceId))
          .map((row): [string, AgentsListingSummary] => [row.sourceId, row]),
      ),
  );
  const collaborators = {
    sources: repository,
    projects: createApiFixture<ProjectApi>({ findInternal }),
    listings: { findAgentsListings },
  };
  const dispatched: AgentListingRequestCommand[] = [];
  const service = GovernanceAgentSyncService.create({
    ...collaborators,
    dispatch: async (command) => {
      dispatched.push(command);
    },
    newRequestId: () => "req-fixed",
    logger: createTestLogger().logger,
  });
  const reads = GovernanceAgentSyncService.forReads(collaborators);
  return { service, reads, dispatched, ids, findInternal, findAgentsListings };
}

describe("requesting an agent listing", () => {
  describe("given two providers that can list and one that cannot", () => {
    /** @scenario "The sync control asks every provider that can list agents" */
    it("asks only the two, under the governance project and one request id", async () => {
      const { service, dispatched, ids } = await buildWorld({ sources: [GENIE, OTEL, COPILOT] });

      const result = await service.requestListing({
        organizationId: "org-1",
        now: 1_700_000_000_000,
      });

      expect(dispatched).toEqual([
        {
          tenantId: "gov-project-1",
          occurredAt: 1_700_000_000_000,
          sourceId: ids.get("Copilot tenant"),
          requestId: "req-fixed",
        },
        {
          tenantId: "gov-project-1",
          occurredAt: 1_700_000_000_000,
          sourceId: ids.get("Prod Genie"),
          requestId: "req-fixed",
        },
      ]);
      expect(result.requested).toBe(2);
    });

    /** @scenario "The sync control reports what it started, not what it found" */
    it("names the sources asked and reports no findings", async () => {
      const { service } = await buildWorld({ sources: [GENIE, OTEL, COPILOT] });

      const result = await service.requestListing({ organizationId: "org-1" });

      expect(result.sources.map((source) => source.name)).toEqual(["Copilot tenant", "Prod Genie"]);
      expect(Object.keys(result).toSorted()).toEqual(["requested", "sources"]);
    });
  });

  describe("given a listable source the scheduler will not pull", () => {
    /** @scenario "A source the scheduler will not pull is not asked, and is still on the screen" */
    it("is left out of the ask and still named on the screen", async () => {
      const { service, reads, dispatched, ids } = await buildWorld({
        sources: [GENIE, UNSCHEDULED_GENIE],
      });

      const result = await service.requestListing({ organizationId: "org-1" });

      expect(dispatched.map((command) => command.sourceId)).toEqual([ids.get("Prod Genie")]);
      expect(result.requested).toBe(1);
      const onScreen = await reads.listableSources({ organizationId: "org-1" });
      expect(onScreen.map((source) => source.name)).toEqual(["Prod Genie", "Staging Genie"]);
    });
  });

  describe("given a listable source that has been disabled", () => {
    /** @scenario "A disabled source has no request sent for it either" */
    it("has no request sent for it and is not counted", async () => {
      const { service, dispatched, ids } = await buildWorld({
        sources: [COPILOT, DISABLED_COPILOT],
      });

      const result = await service.requestListing({ organizationId: "org-1" });

      expect(dispatched.map((command) => command.sourceId)).toEqual([ids.get("Copilot tenant")]);
      expect(result.sources.map((source) => source.name)).toEqual(["Copilot tenant"]);
    });
  });

  describe("given an organization with no provider that can list agents", () => {
    it("asks nothing and does not raise", async () => {
      const { service, dispatched, findInternal } = await buildWorld({ sources: [OTEL] });

      await expect(service.requestListing({ organizationId: "org-1" })).resolves.toEqual({
        requested: 0,
        sources: [],
      });
      expect(dispatched).toEqual([]);
      expect(findInternal).not.toHaveBeenCalled();
    });
  });

  describe("given an organization with no governance project", () => {
    /** @scenario "A sync that cannot be recorded says so instead of appearing to start" */
    it("refuses by code rather than reporting a request it never made", async () => {
      const { service, dispatched } = await buildWorld({ sources: [GENIE], govProjectId: null });

      await expect(service.requestListing({ organizationId: "org-1" })).rejects.toMatchObject({
        code: "agent_listing_unavailable",
      });
      expect(dispatched).toEqual([]);
    });
  });
});

describe("reading which sources can be asked", () => {
  it("needs no dispatcher", async () => {
    const { reads, ids } = await buildWorld({ sources: [GENIE, OTEL] });

    await expect(reads.listableSources({ organizationId: "org-1" })).resolves.toEqual([
      { id: ids.get("Prod Genie"), name: "Prod Genie", sourceType: "databricks_genie" },
    ]);
  });

  it("reads another organization's sources back as none of its own", async () => {
    const { reads } = await buildWorld({ sources: [GENIE, OTEL] });

    await expect(reads.listableSources({ organizationId: "org-2" })).resolves.toEqual([]);
  });

  it("refuses to dispatch from the read door", async () => {
    const { reads } = await buildWorld({ sources: [GENIE] });

    await expect(reads.requestListing({ organizationId: "org-1" })).rejects.toThrow(
      "cannot dispatch",
    );
  });
});

describe("reading how the last listing of each source ended", () => {
  it("carries a refusal and an answer as different outcomes", async () => {
    const { reads } = await buildWorld({
      sources: [GENIE, COPILOT],
      listings: (ids) => [
        {
          sourceId: ids.get("Copilot tenant") ?? "",
          projectId: "gov-project-1",
          LastAgentsListingOutcome: "listed",
          LastAgentsListingReason: null,
        },
        {
          sourceId: ids.get("Prod Genie") ?? "",
          projectId: "gov-project-1",
          LastAgentsListingOutcome: "refused",
          LastAgentsListingReason: "unauthorized",
        },
      ],
    });

    const read = await reads.listableSourcesWithLastListing({ organizationId: "org-1" });

    expect(read.map((source) => [source.name, source.lastListing])).toEqual([
      ["Copilot tenant", { outcome: "listed" }],
      ["Prod Genie", { outcome: "refused", cause: "access" }],
    ]);
  });

  /** @scenario "A source nobody has asked reports nothing known rather than an answer" */
  it("reports nothing known for a source with no recorded listing", async () => {
    const { reads } = await buildWorld({ sources: [GENIE, COPILOT] });

    const read = await reads.listableSourcesWithLastListing({ organizationId: "org-1" });

    expect(read.map((source) => source.lastListing)).toEqual([null, null]);
  });

  /** @scenario "The last listing outcome is read only from this organizations own records" */
  it("never reads an outcome recorded under another organization's project", async () => {
    const { reads } = await buildWorld({
      sources: [GENIE],
      listings: (ids) => [
        {
          sourceId: ids.get("Prod Genie") ?? "",
          projectId: "gov-project-of-someone-else",
          LastAgentsListingOutcome: "refused",
          LastAgentsListingReason: "unauthorized",
        },
      ],
    });

    const read = await reads.listableSourcesWithLastListing({ organizationId: "org-1" });

    expect(read[0]?.lastListing).toBeNull();
  });

  it("reports nothing known when the organization has no governance project", async () => {
    const { reads, findAgentsListings } = await buildWorld({
      sources: [GENIE],
      govProjectId: null,
    });

    const read = await reads.listableSourcesWithLastListing({ organizationId: "org-1" });

    expect(read.map((source) => source.lastListing)).toEqual([null]);
    expect(findAgentsListings).not.toHaveBeenCalled();
  });

  it("reads no projection at all when nothing can be asked", async () => {
    const { reads, findAgentsListings } = await buildWorld({ sources: [OTEL] });

    await expect(
      reads.listableSourcesWithLastListing({ organizationId: "org-1" }),
    ).resolves.toEqual([]);
    expect(findAgentsListings).not.toHaveBeenCalled();
  });
});
