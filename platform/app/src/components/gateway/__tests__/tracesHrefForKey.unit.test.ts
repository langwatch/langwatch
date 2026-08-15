import { describe, expect, it } from "vitest";
import { parseFragment } from "~/features/traces-v2/utils/urlState";
import { translateFilterToClickHouse } from "~/server/app-layer/traces/filter-to-clickhouse/ast";
import { resolveTracesHrefForKey, tracesHrefForKey } from "../tracesHrefForKey";

/**
 * The link is only as good as the two contracts it spans: the Trace
 * Explorer's fragment format, and the query language's attribute syntax.
 * Both are exercised for real here rather than asserted as a string, so a
 * change to either breaks this test instead of the feature.
 */
describe("tracesHrefForKey", () => {
  const href = tracesHrefForKey({
    projectSlug: "acme-inc",
    virtualKeyId: "vk_01HTEST",
  });

  it("points at the trace explorer of the project the traces land in", () => {
    expect(href.startsWith("/acme-inc/traces#")).toBe(true);
  });

  describe("when the trace explorer parses the fragment it produced", () => {
    const parsed = parseFragment(href.slice(href.indexOf("#")));

    it("opens the default listing over the last thirty days", () => {
      expect(parsed?.lensId).toBe("all-traces");
      expect(parsed?.overrides.preset).toBe("30d");
    });

    it("carries the key filter through intact", () => {
      expect(parsed?.overrides.query).toBe(
        'trace.attribute.langwatch.virtual_key_id:"vk_01HTEST"',
      );
    });
  });

  describe("when the query language reads the filter it produced", () => {
    const parsed = parseFragment(href.slice(href.indexOf("#")));
    const translated = translateFilterToClickHouse(
      parsed?.overrides.query ?? "",
      "project_test",
      { from: 1714435200000, to: 1715040000000 },
    );

    it("filters trace summaries on the attribute the gateway stamps", () => {
      expect(translated).not.toBeNull();
      expect(translated!.sql).toContain("Attributes[{");
      const params = Object.values(translated!.params);
      expect(params).toContain("langwatch.virtual_key_id");
      expect(params).toContain("vk_01HTEST");
    });
  });
});

describe("resolveTracesHrefForKey", () => {
  const teams = [{ projects: [{ id: "project-web-app", slug: "web-app" }] }];

  describe("when the destination is live and on one of the viewer's teams", () => {
    it("resolves the link through that project's slug", () => {
      expect(
        resolveTracesHrefForKey({
          teams,
          virtualKeyId: "vk_1",
          traceProjectId: "project-web-app",
          traceProjectArchived: false,
        }),
      ).toBe(
        tracesHrefForKey({ projectSlug: "web-app", virtualKeyId: "vk_1" }),
      );
    });
  });

  describe("when the key has no destination", () => {
    it("resolves to nothing", () => {
      expect(
        resolveTracesHrefForKey({
          teams,
          virtualKeyId: "vk_1",
          traceProjectId: null,
          traceProjectArchived: false,
        }),
      ).toBeUndefined();
    });
  });

  describe("when the destination project was deleted", () => {
    it("resolves to nothing, since it serves no traces any more", () => {
      expect(
        resolveTracesHrefForKey({
          teams,
          virtualKeyId: "vk_1",
          traceProjectId: "project-web-app",
          traceProjectArchived: true,
        }),
      ).toBeUndefined();
    });
  });

  describe("when the destination sits outside the viewer's teams", () => {
    it("resolves to nothing rather than a link that would bounce them", () => {
      expect(
        resolveTracesHrefForKey({
          teams,
          virtualKeyId: "vk_1",
          traceProjectId: "project-elsewhere",
          traceProjectArchived: false,
        }),
      ).toBeUndefined();
    });
  });
});
