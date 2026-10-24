/**
 * Each view of a braided trace protects a span by its owner (ADR-185 §5): the reader's items
 * under the reader's protections, an owner's under the owner's, in the order read.
 * Spec: modules/trace/specs/braided-spans.feature
 */
import type { Protections, SpanSummaryRow } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import {
  braidConditionsShownFor,
  protectByOwner,
  verifiedMarksOf,
} from "../braided-span-owner.rules.ts";
import { mapLegacySpanSummaryToTreeNode } from "../trace-read-mappers.rules.ts";
import { gateResources, resourceInfoOf } from "../trace-view-gates.rules.ts";

const OWNER = "proj_specialists";
const open: Protections = { canSeeCapturedInput: true, hiddenAttributes: [] };
const strict: Protections = {
  canSeeCapturedInput: false,
  hiddenAttributes: [{ pattern: "*", visibleTo: "members of this project" }],
};

type Item = { id: string; ownerProjectId?: string };
const label = (group: Item[], protections: Protections) =>
  group.map((item) => `${item.id}:${protections === strict ? "strict" : "open"}`);

describe("protectByOwner", () => {
  describe("given the reader's items and an owner's, interleaved", () => {
    const items: Item[] = [{ id: "a" }, { id: "b", ownerProjectId: OWNER }, { id: "c" }];

    it("protects each owner's items under its own protections, keeping their order", () => {
      expect(
        protectByOwner({ items, reader: open, owners: new Map([[OWNER, strict]]), protect: label }),
      ).toEqual(["a:open", "b:strict", "c:open"]);
    });

    it("refuses to show an owner's items when its protections were not resolved", () => {
      expect(() =>
        protectByOwner({ items, reader: open, owners: new Map(), protect: label }),
      ).toThrow(OWNER);
    });
  });

  describe("given only the reader's items", () => {
    it("protects them as one group under the reader's protections", () => {
      const groups: Item[][] = [];
      const items: Item[] = [{ id: "a" }, { id: "c" }];
      protectByOwner({
        items,
        reader: open,
        owners: new Map(),
        protect: (group, protections) => {
          groups.push(group);
          return label(group, protections);
        },
      });

      expect(groups).toEqual([[{ id: "a" }, { id: "c" }]]);
    });
  });
});

describe("verifiedMarksOf", () => {
  describe("given a span whose attributes carry verified marks", () => {
    /** @scenario "A braided span from a signed call says who signed it" */
    it("reads each key and the project it names, nested or flat", () => {
      expect(
        verifiedMarksOf({
          params: {
            langwatch: { reserved: { verified: { orchestrator: "proj_orchestrator" } } },
            "langwatch.reserved.verified.web": "proj_web",
            "langwatch.reserved": { "verified.team.a": "proj_team" },
          },
        }),
      ).toEqual([
        { key: "orchestrator", projectId: "proj_orchestrator" },
        { key: "web", projectId: "proj_web" },
        { key: "team.a", projectId: "proj_team" },
      ]);
    });
  });

  describe("given a span with no verified mark", () => {
    it("reads none", () => {
      expect(verifiedMarksOf({ params: { orchestrator: "web" } })).toEqual([]);
      expect(verifiedMarksOf({ params: null })).toEqual([]);
    });
  });
});

describe("braidConditionsShownFor", () => {
  const braids = [
    { ownerProjectId: "proj_specialists", where: 'attributes["orchestrator"] == "web"', fromMs: 0 },
    {
      ownerProjectId: "proj_specialists",
      where: 'attributes["orchestrator"] == "web" and Verified("orchestrator")',
      fromMs: 0,
    },
  ];

  describe("given a span signed for the reader under the condition's key", () => {
    it("lists both conditions", () => {
      expect(
        braidConditionsShownFor({
          braids,
          ownerProjectId: "proj_specialists",
          spanStartedAtMs: 1,
          signedKeys: new Set(["orchestrator"]),
        }),
      ).toEqual([braids[0]!.where, braids[1]!.where]);
    });
  });

  describe("given a span with no mark naming the reader, or one under another key", () => {
    /** @scenario "An unsigned braided span does not claim a condition that needs a signature" */
    it("leaves out the condition that needs a signature", () => {
      for (const signedKeys of [new Set<string>(), new Set(["web"])]) {
        expect(
          braidConditionsShownFor({
            braids,
            ownerProjectId: "proj_specialists",
            spanStartedAtMs: 1,
            signedKeys,
          }),
        ).toEqual([braids[0]!.where]);
      }
    });
  });
});

describe("gateResources", () => {
  const resources = {
    rootSpanId: "root",
    resourceAttributes: { "service.name": "reader-service" },
    scope: null,
    spans: [
      {
        spanId: "root",
        parentSpanId: null,
        resourceAttributes: { "service.name": "reader-service" },
        scope: { name: "test", version: null },
      },
      {
        spanId: "owner-span",
        parentSpanId: "root",
        resourceAttributes: { "service.name": "owner-service" },
        scope: { name: "test", version: null },
        ownerProjectId: OWNER,
      },
    ],
  };

  describe("when a braided span's owner hides its resource attributes", () => {
    it("hides them on the owner's span and keeps the reader's", () => {
      const gated = gateResources({
        resources,
        protections: open,
        ownerProtections: new Map([[OWNER, strict]]),
      });

      expect(gated.spans[0]?.resourceAttributes["service.name"]).toBe("reader-service");
      expect(gated.spans[1]?.resourceAttributes["service.name"]).not.toBe("owner-service");
    });
  });

  describe("when the owner's protections were not resolved", () => {
    it("hides the owner's resource attributes", () => {
      const gated = gateResources({ resources, protections: open });

      expect(gated.spans[1]?.resourceAttributes["service.name"]).not.toBe("owner-service");
    });
  });
});

describe("resourceInfoOf", () => {
  const ingestKey = { "langwatch.api_key.id": "key_1", "service.name": "svc" };
  const row = {
    parentSpanId: "root",
    startTimeMs: 0,
    resourceAttributes: ingestKey,
    scopeName: null,
    scopeVersion: null,
  };

  describe("given a braided span sent with the owner's ingest key", () => {
    /** @scenario "Every view of the trace shows the same braided spans" */
    it("leaves the owner's key out and keeps the reader's", () => {
      const info = resourceInfoOf({
        rows: [
          { ...row, spanId: "root", parentSpanId: null },
          { ...row, spanId: "owner-span", ownerProjectId: OWNER },
        ],
        protections: open,
        ownerProtections: new Map([[OWNER, open]]),
      });

      expect(info.spans.map((span) => span.resourceAttributes)).toEqual([
        ingestKey,
        { "service.name": "svc" },
      ]);
    });
  });
});

describe("mapLegacySpanSummaryToTreeNode", () => {
  const row: SpanSummaryRow = {
    spanId: "s",
    parentSpanId: null,
    spanName: "agent",
    durationMs: 1,
    statusCode: 1,
    spanType: null,
    toolName: null,
    requestId: null,
    querySource: null,
    toolUseId: null,
    model: null,
    cost: null,
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheCreationTokens: null,
    startTimeMs: 0,
    updatedAtMs: 0,
  };

  it("names a braided span's owner on its node", () => {
    expect(mapLegacySpanSummaryToTreeNode({ ...row, ownerProjectId: OWNER }).ownerProjectId).toBe(
      OWNER,
    );
  });

  it("adds no owner to the reader's own span", () => {
    expect(mapLegacySpanSummaryToTreeNode(row)).not.toHaveProperty("ownerProjectId");
  });
});
