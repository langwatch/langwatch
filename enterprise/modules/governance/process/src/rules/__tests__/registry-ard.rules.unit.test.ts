/** Spec: enterprise/modules/governance/specs/agent-registry.feature */
import {
  type AgentRegistryEntry,
  ardSearchRequestSchema,
} from "@langwatch/enterprise-governance-contract";
import { describe, expect, it } from "vitest";

import {
  ardManifestOf,
  ardPublisherOf,
  ardSearch,
} from "../../features/registry/rules/registry-ard.rules.ts";

function entry(overrides: Partial<AgentRegistryEntry> = {}): AgentRegistryEntry {
  return {
    id: "agentreg_1",
    source: "langwatch",
    management: "managed",
    kind: "signature",
    name: "Support bot",
    description: "Answers support tickets",
    status: "active",
    shadow: false,
    version: 3,
    source_version: null,
    project_id: "project-1",
    environment: null,
    owner: null,
    endpoints: [],
    model: null,
    instructions: "Be brief.",
    capabilities: ["signature", "invoke"],
    tools: [
      {
        name: "invoke",
        description: null,
        input_schema: { type: "object", properties: { question: { type: "string" } } },
        output_schema: null,
        status: "active",
        deprecated_in_version: null,
        deprecated_at: null,
      },
    ],
    first_seen_at: "2026-11-01T00:00:00.000Z",
    last_seen_at: null,
    updated_at: "2026-11-02T00:00:00.000Z",
    removed_at: null,
    ...overrides,
  };
}

function manifest(entries: AgentRegistryEntry[]) {
  return ardManifestOf({
    entries,
    publisher: ardPublisherOf("https://app.langwatch.ai"),
    organizationId: "org_acme",
    updatedAt: "2026-11-02T00:00:00.000Z",
  });
}

describe("ardManifestOf()", () => {
  describe("given one active entry", () => {
    /** @scenario An entry maps to an ARD entry with a urn:air identifier and an inline agent card */
    it("publishes a urn:air identifier, the agent card type and the entry inline", () => {
      const [ard] = manifest([entry()]).entries;

      expect(ard?.identifier).toBe("urn:air:app.langwatch.ai:org_acme:agent:agentreg_1");
      expect(ard?.type).toBe("application/agent-card+json");
      expect(ard?.version).toBe("3");
      expect(ard?.data.tools[0]?.input_schema).toEqual({
        type: "object",
        properties: { question: { type: "string" } },
      });
      expect(ard?.data.instructions).toBe("Be brief.");
    });
  });

  describe("given an active and a removed entry", () => {
    /** @scenario Removed entries are left out of the ARD manifest */
    it("lists only the active one", () => {
      const listed = manifest([
        entry(),
        entry({ id: "agentreg_2", status: "removed", name: "Old bot" }),
      ]);

      expect(listed.entries.map((ard) => ard.displayName)).toEqual(["Support bot"]);
    });
  });
});

describe("ardSearch()", () => {
  describe("given two entries and a filtered query", () => {
    /** @scenario ARD search ranks entries by the query text and applies filters */
    it("ranks the matching entry first with a bounded score", () => {
      const listed = manifest([
        entry(),
        entry({ id: "agentreg_2", name: "Billing assistant", description: "Invoices" }),
      ]);

      const response = ardSearch({
        manifest: listed,
        request: ardSearchRequestSchema.parse({
          query: { text: "billing", filter: { "data.source": ["langwatch"] } },
        }),
      });

      expect(response.results[0]?.displayName).toBe("Billing assistant");
      expect(response.results[0]?.score).toBeGreaterThan(0);
      expect(response.results[0]?.score).toBeLessThanOrEqual(100);
    });
  });

  describe("given three matching entries and a page size of two", () => {
    /** @scenario ARD search pages its ranked results with an offset token */
    it("answers two results with a token, then the third without one", () => {
      const listed = manifest(
        ["Support alpha", "Support beta", "Support gamma"].map((name, index) =>
          entry({ id: `agentreg_${index}`, name }),
        ),
      );
      const ask = (pageToken?: string) =>
        ardSearch({
          manifest: listed,
          request: ardSearchRequestSchema.parse({
            query: { text: "support" },
            pageSize: 2,
            ...(pageToken ? { pageToken } : {}),
          }),
        });

      const first = ask();
      const second = ask(first.pageToken);

      expect(first.results.map((result) => result.displayName)).toEqual([
        "Support alpha",
        "Support beta",
      ]);
      expect(first.pageToken).toBe("2");
      expect(second.results.map((result) => result.displayName)).toEqual(["Support gamma"]);
      expect(second.pageToken).toBeUndefined();
    });
  });

  describe("given a request without query text", () => {
    /** @scenario ARD search with no text is refused */
    it("is refused by the request schema", () => {
      const parsed = ardSearchRequestSchema.safeParse({ query: { text: "  " } });

      expect(parsed.success).toBe(false);
    });
  });

  describe("given a filter key that names an inherited property", () => {
    /** @scenario ARD search treats a filter on an inherited property as no match */
    it("answers no results instead of failing", () => {
      const response = ardSearch({
        manifest: manifest([entry()]),
        request: ardSearchRequestSchema.parse({
          query: { text: "support", filter: { toString: ["x"], "data.constructor": ["y"] } },
        }),
      });

      expect(response.results).toEqual([]);
    });
  });
});
