// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Which source types route conversations into a trace destination.
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 *
 * The worker routes an event only when its source has an entry in
 * `CONVERSATION_ROUTING_BY_SOURCE_TYPE` (`pullers/pullerWorker.ts`) and the
 * event's action is the one that entry's profile names. A source type meeting
 * neither condition can carry a destination column that nothing ever reads.
 * The drawer must not offer a control with no effect, and this declaration
 * is what it asks — kept beside the catalog so a new adapter's author sees
 * it while adding their entry.
 *
 * What this test covers, precisely: the client-side declaration alone. That
 * gate lives in server code this bundle must not import, so nothing here
 * reads it — the two are one value written twice, and this file pins only
 * one of the two copies. A server entry added or removed without the
 * matching catalog edit passes every assertion below. Catching that needs a
 * cross-side assertion in a test that may import both, and there is not one;
 * saying so is better than a docblock implying a guard that is not here.
 */
import { describe, expect, it } from "vitest";
import { routesConversations, SOURCE_TYPE_OPTIONS } from "../model/ingestion-source-catalog";

describe("given the ingestion-source catalog", () => {
  describe("when asked which types route conversations", () => {
    it("says the two adapters that emit conversations do", () => {
      expect(routesConversations("databricks_genie")).toBe(true);
      expect(routesConversations("copilot_studio_dataverse")).toBe(true);
    });

    it("says the retired Copilot source does not — it never emitted one", () => {
      expect(routesConversations("copilot_studio")).toBe(false);
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
