/**
 * A trace rule's SEND_WEBHOOK action posting to the stop route: the body the automation renders
 * from the template in docs/governance/kill-switch.mdx, with the organisation key in the action's
 * secret Authorization header. Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
import { buildTemplateContext, renderWebhookBody } from "@langwatch/automation-contract";
import type { AgentStopView } from "@langwatch/enterprise-governance-contract";
import { describe, expect, it } from "vitest";

import { AGENT_ID, buildKillSwitchRest, KEYS } from "./support/kill-switch-rest.fixture.ts";

/** The template the docs give, character for character. */
const DOCUMENTED_TEMPLATE =
  '{"reason": {{ "Trace rule " | append: trigger.name | append: " matched " | append: match.trace.url | json }}, "severity": "critical"}';

async function renderedBody(triggerName: string): Promise<string> {
  const rendered = await renderWebhookBody({
    template: DOCUMENTED_TEMPLATE,
    context: buildTemplateContext({
      trigger: { id: "trigger-1", name: triggerName, alertType: null },
      project: { name: "ACME support", slug: "acme" },
      baseHost: "https://app.langwatch.ai",
      matches: [{ traceId: "trace_123" }],
    }),
  });
  expect(rendered.usedDefault).toBe(false);
  return rendered.body;
}

async function stopWith(body: string) {
  const { call, eventing } = await buildKillSwitchRest();
  const response = await call({
    method: "POST",
    path: `/api/governance/agents/${AGENT_ID}/stop`,
    body,
    key: KEYS.traceRule,
  });
  const json = (await response.json()) as { data: AgentStopView };
  await eventing.close();
  return { status: response.status, stop: json.data };
}

describe("the stop route as a trace rule's webhook action calls it", () => {
  describe("when the automation posts the documented template's body with the API key header", () => {
    /** @scenario "A trace rule's webhook action can call the stop route" */
    it("records the stop with trigger api_key and the automation's reason", async () => {
      const { status, stop } = await stopWith(await renderedBody("Prompt injection"));

      expect(status).toBe(202);
      expect(stop).toMatchObject({
        trigger: "api_key",
        severity: "critical",
        approval: "immediate",
        reason:
          "Trace rule Prompt injection matched https://app.langwatch.ai/acme/traces/trace_123",
      });
    });
  });

  describe("when the trigger name holds double quotes and a backslash", () => {
    /** @scenario "The documented trace rule template keeps the body valid JSON for any trigger name" */
    it("still posts valid JSON and records the name as written", async () => {
      const { status, stop } = await stopWith(await renderedBody('Leak of "secrets" \\ keys'));

      expect(status).toBe(202);
      expect(stop.reason).toBe(
        'Trace rule Leak of "secrets" \\ keys matched https://app.langwatch.ai/acme/traces/trace_123',
      );
    });
  });
});
