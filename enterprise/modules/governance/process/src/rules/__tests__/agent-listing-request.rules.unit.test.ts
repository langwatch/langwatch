// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { describe, expect, it } from "vitest";

import { agentListingRequests, listableAgentSources } from "../agent-listing-request.rules.ts";

const source = (over: Partial<{ id: string; name: string; sourceType: string }>) => ({
  id: "src-1",
  name: "A source",
  sourceType: "databricks_genie",
  ...over,
});

describe("choosing which sources to ask", () => {
  describe("given sources whose providers can list agents", () => {
    it("keeps them", () => {
      const sources = [
        source({ id: "genie", sourceType: "databricks_genie" }),
        source({ id: "copilot", sourceType: "copilot_studio_dataverse" }),
      ];

      expect(listableAgentSources(sources).map((s) => s.id)).toEqual(["genie", "copilot"]);
    });
  });

  describe("given a source whose provider has no agent listing", () => {
    it("drops it", () => {
      const sources = [
        source({ id: "otel", sourceType: "otel_generic" }),
        source({ id: "genie", sourceType: "databricks_genie" }),
      ];

      expect(listableAgentSources(sources).map((s) => s.id)).toEqual(["genie"]);
    });
  });

  describe("given an organization with no listable source at all", () => {
    it("returns none rather than falling back to every source", () => {
      expect(listableAgentSources([source({ sourceType: "otel_generic" })])).toEqual([]);
    });
  });
});

describe("turning one press into commands", () => {
  describe("given two sources and one press", () => {
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
