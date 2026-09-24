import {
  filterBlockKit,
  renderLiquid,
  EXAMPLE_MATCHES,
  buildExampleGraphAlertTemplateContext,
  buildReportTemplateContext,
  buildTemplateContext,
  type GraphAlertTemplateContext,
  AlertType,
  TriggerAction,
} from "@langwatch/automation-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  SLACK_BLOCK_KIT_TEMPLATES,
  type SlackBlockKitTemplateOption,
} from "../../slack-templates/index.ts";
import {
  ACTION_PROVIDERS,
  CLIENT_PROVIDERS,
  NOTIFY_PROVIDERS,
} from "../ui/sections/client-providers.ts";

/**
 * The browser provider registry enforces its client-facing invariants here.
 * Failures mean it has drifted from the `TriggerAction` enum or its category
 * partitions, which would silently break the drawer when a new action lands.
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

      it("partitions the enum between notify and action categories", () => {
        const notifyActions = NOTIFY_PROVIDERS.map((p) => p.shared.action);
        const actionActions = ACTION_PROVIDERS.map((p) => p.shared.action);
        expect(new Set([...notifyActions, ...actionActions])).toEqual(
          new Set(Object.values(TriggerAction)),
        );
        expect(notifyActions.some((a) => actionActions.includes(a))).toBe(false);
      });

      it("gives notify providers a channel string the preview/testFire endpoints accept", () => {
        const channels = NOTIFY_PROVIDERS.flatMap((p) =>
          "channel" in p.client ? [p.client.channel] : [],
        );
        for (const channel of channels) {
          expect(["email", "slack", "webhook"]).toContain(channel);
        }
      });

      /** @scenario "Provider authoring uses one browser surface" */
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
          start: Temporal.Instant.from("2026-01-01T10:00:00Z"),
          end: Temporal.Instant.from("2026-01-01T11:00:00Z"),
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
    const reasonForTemplate = (id: string): GraphAlertTemplateContext["reason"] => {
      if (id === "graph_alert_resolved") return "heartbeat-resolve";
      if (id === "graph_alert_no_data") return "heartbeat-absence";
      return "real-time";
    };
    const graphAlertContextFor = (id: string): GraphAlertTemplateContext => ({
      ...graphAlertBase,
      reason: reasonForTemplate(id),
    });
    // A report layout only ever renders against the source it is offered for,
    // so each one is exercised with THAT source's data — a chart layout gets
    // charts, a trace layout gets traces. Feeding a chart layout the trace
    // context would prove nothing about whether it can plot.
    const reportTraceContext = buildReportTemplateContext({
      trigger: { id: "rep_1", name: "Weekly error report" },
      report: {
        sourceLabel: "Top 5 matching traces",
        scheduleLabel: "every Monday at 09:00 (UTC)",
        sourceKind: "traceQuery",
      },
      viewUrl: "https://app.langwatch.ai/acme/traces",
      traces: [
        {
          traceId: "trace_a",
          url: "https://app.langwatch.ai/acme/traces/trace_a",
          timestamp: "2026-01-05T08:30:00.000Z",
          input: "502 upstream timeout",
          output: "",
          model: "gpt-5-mini",
          status: "error",
          costUsd: 0.0241,
          durationMs: 1834,
        },
        {
          traceId: "trace_b",
          url: "https://app.langwatch.ai/acme/traces/trace_b",
          timestamp: "2026-01-05T08:45:00.000Z",
          input: "tool call failed",
          output: "",
          model: "gpt-5-mini",
          status: "error",
          costUsd: 0.0102,
          durationMs: 920,
        },
      ],
      occurredAt: Temporal.Instant.from("2026-01-05T09:00:00Z"),
      project: { id: "p1", name: "Acme", slug: "acme" },
      baseHost: "https://app.langwatch.ai",
    });
    const reportChartContext = (sourceKind: "customGraph" | "dashboard") =>
      buildReportTemplateContext({
        trigger: { id: "rep_2", name: "Weekly latency report" },
        report: {
          sourceLabel: sourceKind === "dashboard" ? "Dashboard" : "Custom graph",
          scheduleLabel: "every Monday at 09:00 (UTC)",
          sourceKind,
        },
        viewUrl: "https://app.langwatch.ai/acme/analytics",
        charts: [
          {
            id: "graph_1",
            title: "Errors per hour",
            type: "line",
            categories: ["09:00", "10:00", "11:00"],
            series: [
              {
                name: "Errors",
                data: [
                  { label: "09:00", value: 3 },
                  { label: "10:00", value: 7 },
                  { label: "11:00", value: 2 },
                ],
              },
            ],
            segments: [],
            total: 12,
            isEmpty: false,
          },
          {
            id: "graph_2",
            title: "Cost by model",
            type: "pie",
            categories: [],
            series: [],
            segments: [
              { label: "gpt-5-mini", value: 4.2 },
              { label: "claude-opus-4-8", value: 1.8 },
            ],
            total: 6,
            isEmpty: false,
          },
        ],
        occurredAt: Temporal.Instant.from("2026-01-05T09:00:00Z"),
        project: { id: "p1", name: "Acme", slug: "acme" },
        baseHost: "https://app.langwatch.ai",
      });
    const contextForReport = (template: SlackBlockKitTemplateOption): Record<string, unknown> => {
      const sources = template.reportSources ?? [];
      if (sources.includes("dashboard")) {
        return { ...reportChartContext("dashboard") };
      }
      if (sources.includes("customGraph")) {
        return { ...reportChartContext("customGraph") };
      }
      return { ...reportTraceContext };
    };
    const contextForTemplate = (
      template: SlackBlockKitTemplateOption,
      cadence: "immediate" | "digest",
    ): Record<string, unknown> => {
      if (template.kind === "graphAlert") {
        return { ...graphAlertContextFor(template.id) };
      }
      if (template.kind === "report") {
        return contextForReport(template);
      }
      return { ...contextsByCadence[cadence] };
    };

    describe("when each template renders against the example context for its kind and cadence", () => {
      it.each(SLACK_BLOCK_KIT_TEMPLATES.map((t) => [t.id, t] as const))(
        "%s produces a non-empty Block Kit blocks array",
        async (_id, template) => {
          const cadences =
            template.cadenceFit === "both"
              ? (["immediate", "digest"] as const)
              : ([template.cadenceFit] as const);
          for (const cadence of cadences) {
            const context = contextForTemplate(template, cadence);
            const { output } = await renderLiquid({
              template: template.source,
              context,
            });
            const blocks: unknown = JSON.parse(output);
            expect(Array.isArray(blocks)).toBe(true);
            expect((blocks as unknown[]).length).toBeGreaterThan(0);
          }
        },
      );
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
        start: Temporal.Instant.from("2026-01-01T10:00:00Z"),
        end: Temporal.Instant.from("2026-01-01T11:00:00Z"),
      },
    });
    const modernExamples: Record<string, () => Record<string, unknown>> = {
      graph_alert_detailed: () => ({ ...graphAlertContextFor("graph_alert_detailed") }),
      graph_alert_resolved: () => ({ ...graphAlertContextFor("graph_alert_resolved") }),
      graph_alert_no_data: () => ({ ...graphAlertContextFor("graph_alert_no_data") }),
      graph_alert_history_table: () => ({ ...graphAlertContextFor("graph_alert_history_table") }),
      trace_card_rich: () => ({ ...richTraceContext }),
      eval_failure_rich: () => ({ ...richTraceContext }),
      digest_evaluator_rollup: () => ({ ...digestTraceContext }),
      digest_table: () => ({ ...digestTraceContext }),
      report_summary_card: () => ({ ...reportTraceContext }),
      report_table: () => ({ ...reportTraceContext }),
      report_digest: () => ({ ...reportTraceContext }),
      report_chart: () => ({ ...reportChartContext("customGraph") }),
      report_chart_card: () => ({ ...reportChartContext("customGraph") }),
      report_dashboard: () => ({ ...reportChartContext("dashboard") }),
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
          // Every modern template survives the allowlist non-empty: the gated
          // hero block (alert / card / data_visualization / data_table) is
          // stripped by default, and the template degrades to its surrounding
          // allowlisted header / section / rich_text / context fallback.
          const survivors = filterBlockKit(blocks);
          expect(survivors.length).toBeGreaterThan(0);
          // The gated hero is indeed dropped on the default (webhook) path.
          expect(survivors.map((b) => b.type)).not.toContain(template!.gatedBlock);
        },
      );
    });
  });
});
