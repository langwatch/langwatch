// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Which sources an on-demand listing is asked of, and what the ask looks like.
 *
 * Spec: specs/ai-governance/dashboard/agents-page.feature
 */

import { describe, expect, it } from "vitest";

import {
  agentListingRequests,
  listableAgentSources,
} from "../agentListingRequest";

const source = (
  over: Partial<{ id: string; name: string; sourceType: string }>,
) => ({
  id: "src-1",
  name: "A source",
  sourceType: "databricks_genie",
  ...over,
});

describe("choosing which sources to ask", () => {
  describe("given sources whose providers can list agents", () => {
    /** @scenario "The sync control asks every provider that can list agents" */
    it("keeps them", () => {
      const sources = [
        source({ id: "genie", sourceType: "databricks_genie" }),
        source({ id: "copilot", sourceType: "copilot_studio_dataverse" }),
      ];

      expect(listableAgentSources(sources).map((s) => s.id)).toEqual([
        "genie",
        "copilot",
      ]);
    });
  });

  describe("given a source whose provider has no agent listing", () => {
    /**
     * Dropped before the ask rather than asked and refused. The refusal would
     * be `not_configured`, which is knowable without spending a pipeline lease
     * and a provider call to find out.
     */
    /** @scenario "The sync control asks every provider that can list agents" */
    it("drops it", () => {
      const sources = [
        source({ id: "otel", sourceType: "otel_generic" }),
        source({ id: "genie", sourceType: "databricks_genie" }),
      ];

      expect(listableAgentSources(sources).map((s) => s.id)).toEqual(["genie"]);
    });
  });

  describe("given an organization with no listable source at all", () => {
    /** @scenario "An organization with no listing provider is told so" */
    it("returns none rather than falling back to every source", () => {
      expect(
        listableAgentSources([source({ sourceType: "otel_generic" })]),
      ).toEqual([]);
    });
  });
});

describe("turning one press into commands", () => {
  describe("given two sources and one press", () => {
    /**
     * One command per source, because the aggregate IS the source: two sources
     * are two streams, and an organization-wide ask would have nowhere to land.
     * One request id across both, because it names the press — the idempotency
     * key is derived from the source and the request together, so a shared id
     * still gives each source a key of its own.
     */
    /** @scenario "The sync control asks every provider that can list agents" */
    it("asks each source under one request id", () => {
      const commands = agentListingRequests({
        sources: [source({ id: "genie" }), source({ id: "copilot" })],
        tenantId: "gov-project-1",
        requestId: "req-1",
        now: 1_700_000_000_000,
      });

      expect(commands).toEqual([
        {
          tenantId: "gov-project-1",
          occurredAt: 1_700_000_000_000,
          sourceId: "genie",
          requestId: "req-1",
        },
        {
          tenantId: "gov-project-1",
          occurredAt: 1_700_000_000_000,
          sourceId: "copilot",
          requestId: "req-1",
        },
      ]);
    });
  });

  describe("given no sources", () => {
    /** @scenario "An organization with no listing provider is told so" */
    it("produces no commands", () => {
      expect(
        agentListingRequests({
          sources: [],
          tenantId: "gov-project-1",
          requestId: "req-1",
          now: 1,
        }),
      ).toEqual([]);
    });
  });
});
