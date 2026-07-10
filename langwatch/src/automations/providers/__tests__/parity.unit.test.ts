import { AlertType, TriggerAction } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { filterBlockKit } from "~/shared/templating/blockKitAllowlist";
import { renderLiquid } from "~/shared/templating/engine";
import { EXAMPLE_MATCHES } from "~/shared/templating/exampleContext";
import {
  buildExampleGraphAlertTemplateContext,
  buildTemplateContext,
  type GraphAlertTemplateContext,
} from "~/shared/templating/templateContext";
import {
  ACTION_PROVIDERS,
  CLIENT_PROVIDERS,
  NOTIFY_PROVIDERS,
} from "../client";
import { SLACK_BLOCK_KIT_TEMPLATES } from "../definitions/slack/templates/registry";
import { SERVER_PROVIDERS } from "../server";

/**
 * The provider system enforces two invariants here. Failures mean the
 * registries have drifted from the `TriggerAction` enum or each other —
 * which would silently break the drawer or the server dispatcher when a
 * new action type lands. Keep this test passing.
 */
describe("provider registry parity", () => {
  describe("given the TriggerAction enum", () => {
    describe("when registries are built", () => {
      it("registers every TriggerAction on the client", () => {
        for (const action of Object.values(TriggerAction)) {
          expect(CLIENT_PROVIDERS[action]).toBeDefined();
          expect(CLIENT_PROVIDERS[action].shared.action).toBe(action);
        }
      });

      it("registers every TriggerAction on the server", () => {
        for (const action of Object.values(TriggerAction)) {
          expect(SERVER_PROVIDERS[action]).toBeDefined();
          expect(SERVER_PROVIDERS[action].shared.action).toBe(action);
        }
      });

      it("shares the same shared definition between client and server per action", () => {
        for (const action of Object.values(TriggerAction)) {
          expect(CLIENT_PROVIDERS[action].shared).toBe(
            SERVER_PROVIDERS[action].shared,
          );
        }
      });

      it("partitions the enum between notify and action categories", () => {
        const notifyActions = NOTIFY_PROVIDERS.map((p) => p.shared.action);
        const actionActions = ACTION_PROVIDERS.map((p) => p.shared.action);
        expect(new Set([...notifyActions, ...actionActions])).toEqual(
          new Set(Object.values(TriggerAction)),
        );
        expect(notifyActions.some((a) => actionActions.includes(a))).toBe(
          false,
        );
      });

      it("gives notify providers a channel string the preview/testFire endpoints accept", () => {
        for (const p of NOTIFY_PROVIDERS) {
          expect(["email", "slack"]).toContain(p.client.channel);
        }
      });

      it("exposes a config form, an icon, and the slice helpers on every provider", () => {
        for (const action of Object.values(TriggerAction)) {
          const p = CLIENT_PROVIDERS[action];
          expect(p.client.Icon).toBeDefined();
          expect(p.client.ConfigForm).toBeDefined();
          expect(typeof p.client.initialSlice).toBe("function");
          expect(typeof p.client.isComplete).toBe("function");
          expect(typeof p.client.summary).toBe("function");
          expect(typeof p.client.fromTriggerRow).toBe("function");
          expect(typeof p.client.toActionParams).toBe("function");
        }
      });
    });
  });

  describe("given the bundled Slack Block Kit templates", () => {
    const baseContext = {
      trigger: {
        id: "tr_1",
        name: "High latency",
        alertType: AlertType.WARNING,
      },
      project: { name: "Acme", slug: "acme" },
      baseHost: "https://app.langwatch.ai",
      matches: EXAMPLE_MATCHES,
    };
    const contextsByCadence = {
      immediate: buildTemplateContext(baseContext),
      digest: buildTemplateContext({
        ...baseContext,
        window: {
          start: new Date("2026-01-01T10:00:00Z"),
          end: new Date("2026-01-01T11:00:00Z"),
        },
      }),
    } as const;
    const graphAlertBase = buildExampleGraphAlertTemplateContext({
      baseHost: "https://app.langwatch.ai",
      project: { name: "Acme", slug: "acme" },
      trigger: { name: "High latency", alertType: "WARNING" },
    });
    // The reason-keyed lifecycle templates (ADR-041 Phase 1) branch on
    // `reason`; render each against the reason it is built for so the primary
    // branch is exercised. The others read the breach path (`real-time`).
    const reasonForTemplate = (
      id: string,
    ): GraphAlertTemplateContext["reason"] =>
      id === "graph_alert_resolved"
        ? "heartbeat-resolve"
        : id === "graph_alert_no_data"
          ? "heartbeat-absence"
          : "real-time";
    const graphAlertContextFor = (id: string): GraphAlertTemplateContext => ({
      ...graphAlertBase,
      reason: reasonForTemplate(id),
    });

    describe("when each template renders against the example context for its kind and cadence", () => {
      it.each(
        SLACK_BLOCK_KIT_TEMPLATES.map((t) => [t.id, t] as const),
      )("%s produces a non-empty Block Kit blocks array", async (_id, template) => {
        const cadences =
          template.cadenceFit === "both"
            ? (["immediate", "digest"] as const)
            : ([template.cadenceFit] as const);
        for (const cadence of cadences) {
          const context =
            template.kind === "graphAlert"
              ? graphAlertContextFor(template.id)
              : contextsByCadence[cadence];
          const { output } = await renderLiquid({
            template: template.source,
            context: context as unknown as Record<string, unknown>,
          });
          const blocks: unknown = JSON.parse(output);
          expect(Array.isArray(blocks)).toBe(true);
          expect((blocks as unknown[]).length).toBeGreaterThan(0);
        }
      });
    });

    // ADR-041 modern suite. A complete trace context (metadata model/cost/
    // latency + a failing structured-output evaluation) so the rich cards
    // reference nothing the example omits; digest cadence for the digest table.
    const richTraceContext = buildTemplateContext({
      trigger: {
        id: "tr_rich",
        name: "Eval failures",
        alertType: AlertType.CRITICAL,
      },
      project: { name: "Acme", slug: "acme" },
      baseHost: "https://app.langwatch.ai",
      matches: [
        {
          traceId: "trace_rich",
          input: "Summarize the Q3 earnings call.",
          output: '{"summary":"Revenue up 12% year over year."}',
          metadata: {
            model: "gpt-5-mini",
            duration_ms: 1830,
            cost: 0.0021,
            customer_id: "cust_9",
          },
          evaluation: {
            score: 0.41,
            passed: false,
            label: "off-topic",
            evaluatorName: "Answer Relevancy",
          },
        },
      ],
    });
    const digestTraceContext = buildTemplateContext({
      trigger: {
        id: "tr_dig",
        name: "Hourly digest",
        alertType: AlertType.WARNING,
      },
      project: { name: "Acme", slug: "acme" },
      baseHost: "https://app.langwatch.ai",
      matches: EXAMPLE_MATCHES,
      window: {
        start: new Date("2026-01-01T10:00:00Z"),
        end: new Date("2026-01-01T11:00:00Z"),
      },
    });
    const modernExamples: Record<string, () => Record<string, unknown>> = {
      graph_alert_resolved: () =>
        graphAlertContextFor("graph_alert_resolved") as unknown as Record<
          string,
          unknown
        >,
      graph_alert_no_data: () =>
        graphAlertContextFor("graph_alert_no_data") as unknown as Record<
          string,
          unknown
        >,
      graph_alert_history_table: () =>
        graphAlertContextFor(
          "graph_alert_history_table",
        ) as unknown as Record<string, unknown>,
      trace_card_rich: () =>
        richTraceContext as unknown as Record<string, unknown>,
      eval_failure_rich: () =>
        richTraceContext as unknown as Record<string, unknown>,
      digest_table: () =>
        digestTraceContext as unknown as Record<string, unknown>,
    };

    describe("when a modern-suite template (ADR-041) renders against a complete example", () => {
      it.each(Object.keys(modernExamples))(
        "%s renders valid, allowlist-surviving Block Kit with no missing variables",
        async (id) => {
          const template = SLACK_BLOCK_KIT_TEMPLATES.find((t) => t.id === id);
          expect(template).toBeDefined();
          const { output, missingVariables } = await renderLiquid({
            template: template!.source,
            context: modernExamples[id]!(),
          });
          const blocks = JSON.parse(output) as unknown[];
          expect(Array.isArray(blocks)).toBe(true);
          expect(blocks.length).toBeGreaterThan(0);
          // No dangling references — the author (or preview) sees a clean bill.
          expect(missingVariables).toEqual([]);
          // Every template survives the allowlist non-empty: rich_text passes
          // through, and the gated table templates degrade to their
          // surrounding header/section/context blocks.
          const survivors = filterBlockKit(blocks);
          expect(survivors.length).toBeGreaterThan(0);
        },
      );
    });
  });
});
