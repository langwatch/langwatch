import { describe, expect, it } from "vitest";
import { parseFragment } from "@langwatch/trace-web";
import { TraceQueryClickHouse } from "@langwatch/trace-server";
import { resolveTracesHrefForKey, tracesHrefForKey } from "../model/traces-href-for-key";

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
    const translated = TraceQueryClickHouse.translateFilter(
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

describe("tracesHrefForKey over a stated window", () => {
  describe("when the caller names one of the explorer's own presets", () => {
    const href = tracesHrefForKey({
      projectSlug: "acme-inc",
      virtualKeyId: "vk_01HTEST",
      window: { presetId: "24h" },
    });
    const parsed = parseFragment(href.slice(href.indexOf("#")));

    it("opens on that preset instead of the default thirty days", () => {
      expect(parsed?.overrides.preset).toBe("24h");
    });
  });

  describe("when the period has no preset to name", () => {
    const href = tracesHrefForKey({
      projectSlug: "acme-inc",
      virtualKeyId: "vk_01HTEST",
      window: { fromMs: 1714435200000, toMs: 1715040000000 },
    });
    const parsed = parseFragment(href.slice(href.indexOf("#")));

    it("carries the exact instants, and no preset to override them", () => {
      expect(parsed?.overrides.timeFrom).toBe(1714435200000);
      expect(parsed?.overrides.timeTo).toBe(1715040000000);
      expect(parsed?.overrides.preset).toBeUndefined();
    });
  });
});

describe("tracesHrefForKey narrowed to one model", () => {
  describe("when the model name needs quoting", () => {
    const href = tracesHrefForKey({
      projectSlug: "acme-inc",
      virtualKeyId: "vk_01HTEST",
      model: "anthropic/claude-sonnet-4-5",
    });
    const parsed = parseFragment(href.slice(href.indexOf("#")));

    it("joins the two clauses with an explicit AND", () => {
      expect(parsed?.overrides.query).toBe(
        'trace.attribute.langwatch.virtual_key_id:"vk_01HTEST" AND model:"anthropic/claude-sonnet-4-5"',
      );
    });

    describe("when the query language reads the two clauses back", () => {
      const translated = TraceQueryClickHouse.translateFilter(
        parsed?.overrides.query ?? "",
        "project_test",
        { from: 1714435200000, to: 1715040000000 },
      );

      it("filters on the key and the model together", () => {
        expect(translated).not.toBeNull();
        const params = Object.values(translated!.params);
        expect(params).toContain("vk_01HTEST");
        expect(params).toContain("anthropic/claude-sonnet-4-5");
      });
    });
  });

  describe("when the model name needs no quoting", () => {
    it("leaves it unquoted", () => {
      const bare = tracesHrefForKey({
        projectSlug: "acme-inc",
        virtualKeyId: "vk_01HTEST",
        model: "gpt-5-mini",
      });
      expect(parseFragment(bare.slice(bare.indexOf("#")))?.overrides.query).toBe(
        'trace.attribute.langwatch.virtual_key_id:"vk_01HTEST" AND model:gpt-5-mini',
      );
    });
  });

  describe("when no model is picked", () => {
    it("omits the model clause", () => {
      const unfiltered = tracesHrefForKey({
        projectSlug: "acme-inc",
        virtualKeyId: "vk_01HTEST",
        model: null,
      });
      expect(
        parseFragment(unfiltered.slice(unfiltered.indexOf("#")))?.overrides.query,
      ).toBe('trace.attribute.langwatch.virtual_key_id:"vk_01HTEST"');
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
      ).toBe(tracesHrefForKey({ projectSlug: "web-app", virtualKeyId: "vk_1" }));
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
