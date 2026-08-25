// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Which source types route conversations into a trace destination.
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 *
 * The worker's own gate is `event.action === GENIE_QUERY_ACTION`
 * (`genieTraceMapper.ts:239`), so a source type that emits no such event
 * can carry a destination column that nothing ever reads. The drawer must
 * not offer a control with no effect, and this declaration is what it
 * asks — kept beside the catalog so a new adapter's author sees it while
 * adding their entry.
 */
import { describe, expect, it } from "vitest";
import {
  routesConversations,
  SOURCE_TYPE_OPTIONS,
} from "../ingestionSourceCatalog";

describe("given the ingestion-source catalog", () => {
  describe("when asked which types route conversations", () => {
    it("says Genie does, because it is the one adapter emitting conversations", () => {
      expect(routesConversations("databricks_genie")).toBe(true);
    });

    it("says an aggregate pull does not — its events are counts", () => {
      expect(routesConversations("anthropic_admin")).toBe(false);
    });

    it("says a push-mode source does not: routing runs only inside a pull", () => {
      expect(routesConversations("otel_generic")).toBe(false);
      expect(routesConversations("claude_cowork")).toBe(false);
    });

    it("answers for every type in the catalog, so a new adapter must decide", () => {
      for (const option of SOURCE_TYPE_OPTIONS) {
        expect(typeof routesConversations(option.value)).toBe("boolean");
      }
    });

    it("never claims a push-mode type routes, whatever its entry says", () => {
      const lying = SOURCE_TYPE_OPTIONS.filter(
        (o) => o.mode === "push" && routesConversations(o.value),
      );
      expect(lying).toEqual([]);
    });
  });
});
