// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * What one press of the sync control actually dispatches.
 *
 * Against a fake client rather than a database, in the shape
 * `governanceCostRollupMarkers.repository.unit.test.ts` uses: what is being
 * pinned is the decision — which sources get asked, what tenant the ask is
 * filed under, and that the call returns without waiting for a provider — and
 * none of that needs Postgres to be wrong in an interesting way.
 *
 * Spec: specs/ai-governance/dashboard/agents-page.feature
 */

import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "~/generated/prisma/client";

import { AgentListingUnavailableError } from "../governanceAgentSync.errors";
import { GovernanceAgentSyncService } from "../governanceAgentSync.service";
import type { AgentListingRequestCommand } from "../logic/agentListingRequest";

interface FakeSource {
  id: string;
  name: string;
  sourceType: string;
}

/**
 * Enough client for the two reads this service makes: the org's sources, and
 * the hidden governance project the ask is tenanted to.
 */
function fakeClient({
  sources,
  govProjectId = "gov-project-1",
}: {
  sources: FakeSource[];
  govProjectId?: string | null;
}) {
  return {
    ingestionSource: { findMany: vi.fn(async () => sources) },
    project: {
      findFirst: vi.fn(async () =>
        govProjectId ? { id: govProjectId } : null,
      ),
    },
  } as unknown as PrismaClient;
}

const GENIE: FakeSource = {
  id: "src-genie",
  name: "Prod Genie",
  sourceType: "databricks_genie",
};
const COPILOT: FakeSource = {
  id: "src-copilot",
  name: "Copilot tenant",
  sourceType: "copilot_studio_dataverse",
};
const OTEL: FakeSource = {
  id: "src-otel",
  name: "Traces",
  sourceType: "otel_generic",
};

function serviceFor(client: PrismaClient) {
  const dispatched: AgentListingRequestCommand[] = [];
  const service = GovernanceAgentSyncService.create({
    prisma: client,
    dispatch: async (command) => {
      dispatched.push(command);
    },
    newRequestId: () => "req-fixed",
  });
  return { service, dispatched };
}

describe("requesting an agent listing", () => {
  describe("given two providers that can list and one that cannot", () => {
    /** @scenario "The sync control asks every provider that can list agents" */
    it("asks only the two, under the governance project", async () => {
      const { service, dispatched } = serviceFor(
        fakeClient({ sources: [GENIE, OTEL, COPILOT] }),
      );

      const result = await service.requestListing({
        organizationId: "org-1",
        now: 1_700_000_000_000,
      });

      expect(dispatched).toEqual([
        {
          tenantId: "gov-project-1",
          occurredAt: 1_700_000_000_000,
          sourceId: "src-genie",
          requestId: "req-fixed",
        },
        {
          tenantId: "gov-project-1",
          occurredAt: 1_700_000_000_000,
          sourceId: "src-copilot",
          requestId: "req-fixed",
        },
      ]);
      expect(result.requested).toBe(2);
    });

    /**
     * The result says what was ASKED. There is no field here for what a
     * provider answered, and there must not be: the answers land in the log
     * after this call has returned.
     */
    /** @scenario "The sync control reports what it started, not what it found" */
    it("names the sources asked and reports no findings", async () => {
      const { service } = serviceFor(
        fakeClient({ sources: [GENIE, OTEL, COPILOT] }),
      );

      const result = await service.requestListing({ organizationId: "org-1" });

      expect(result.sources.map((source) => source.name)).toEqual([
        "Prod Genie",
        "Copilot tenant",
      ]);
      expect(Object.keys(result).sort()).toEqual(["requested", "sources"]);
    });
  });

  describe("given an organization with no provider that can list agents", () => {
    /**
     * Zero rather than a raise. It is not a fault: the reader has connected
     * nothing that lists agents, the screen has a sentence for exactly that,
     * and an exception would replace the sentence with a red box.
     */
    /** @scenario "An organization with no listing provider is told so" */
    it("asks nothing and does not raise", async () => {
      const client = fakeClient({ sources: [OTEL] });
      const { service, dispatched } = serviceFor(client);

      await expect(
        service.requestListing({ organizationId: "org-1" }),
      ).resolves.toEqual({ requested: 0, sources: [] });
      expect(dispatched).toEqual([]);
      // The tenant is never resolved, because there was nothing to file.
      expect(client.project.findFirst).not.toHaveBeenCalled();
    });
  });

  describe("given an organization with no governance project", () => {
    /**
     * The ask cannot be recorded at all, so nothing is coming later and the
     * reader must not be told to wait for it.
     */
    /** @scenario "A sync that cannot be recorded says so instead of appearing to start" */
    it("refuses by name rather than reporting a request it never made", async () => {
      const { service, dispatched } = serviceFor(
        fakeClient({ sources: [GENIE], govProjectId: null }),
      );

      await expect(
        service.requestListing({ organizationId: "org-1" }),
      ).rejects.toBeInstanceOf(AgentListingUnavailableError);
      expect(dispatched).toEqual([]);
    });
  });

  describe("given a read of which sources can be asked", () => {
    /** @scenario "An organization with no listing provider is told so" */
    it("needs no dispatcher", async () => {
      const service = GovernanceAgentSyncService.forReads(
        fakeClient({ sources: [GENIE, OTEL] }),
      );

      await expect(
        service.listableSources({ organizationId: "org-1" }),
      ).resolves.toEqual([
        { id: "src-genie", name: "Prod Genie", sourceType: "databricks_genie" },
      ]);
    });
  });
});
