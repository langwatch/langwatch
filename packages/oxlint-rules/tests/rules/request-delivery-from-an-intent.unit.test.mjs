import { afterAll, describe, expect, it } from "vitest";

import { requestDeliveryFromAnIntentRule } from "../../src/rules/request-delivery-from-an-intent.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { process: {} } } },
});

afterAll(() => workspace.cleanup());

const SERVICE = "modules/agent/process/src/services/agent-alert.service.ts";
const TEST = "modules/agent/process/src/services/__tests__/agent-alert.service.unit.test.ts";

function report(code, filename = SERVICE) {
  return runRule(requestDeliveryFromAnIntentRule, { code, cwd: workspace.cwd, filename }).map(
    ({ data, line, messageId }) => ({ data, line, messageId }),
  );
}

describe("given a module's process source", () => {
  describe("when a service method calls requestDelivery directly", () => {
    /** @scenario "A requestDelivery call outside an intent executor is reported" */
    it("reports requestDeliveryOutsideIntent naming the receiver", () => {
      const code = [
        "export class AgentAlertService {",
        "  async raise(alert) {",
        "    await this.deps.webhooks.requestDelivery({ destinationId: alert.endpointId });",
        "  }",
        "}",
      ].join("\n");

      expect(report(code)).toEqual([
        {
          data: { callee: "this.deps.webhooks" },
          line: 3,
          messageId: "requestDeliveryOutsideIntent",
        },
      ]);
    });
  });

  describe("when requestDelivery is called from an intent executor", () => {
    /** @scenario "A requestDelivery call inside an intent executor is allowed" */
    it("reports nothing for a typed factory, a typed const or a .intent argument", () => {
      const code = [
        'import type { IntentExecutor } from "@langwatch/eventing";',
        "export function deliverAlert(deps): IntentExecutor<Alert> {",
        "  return async (payload) => { await deps.webhooks.requestDelivery(payload); };",
        "}",
        "export const deliver: IntentExecutor<Alert> = async (payload) => {",
        "  await webhooks.requestDelivery(payload);",
        "};",
        "pm.intent('deliver', schema, async (payload) => webhooks.requestDelivery(payload));",
      ].join("\n");

      expect(report(code)).toEqual([]);
    });
  });

  describe("when the destination kind's own requestDelivery member delegates to its service", () => {
    /** @scenario "A destination kind's requestDelivery implementation may delegate" */
    it("reports only the call made outside that member", () => {
      const code = [
        "export class WebhookModule {",
        "  #requests;",
        "  requestDelivery = (input) => this.#requests.requestDelivery(input);",
        "  async other(input) { return this.#requests.requestDelivery(input); }",
        "}",
      ].join("\n");

      expect(report(code)).toEqual([
        {
          data: { callee: "this.#requests" },
          line: 4,
          messageId: "requestDeliveryOutsideIntent",
        },
      ]);
    });
  });

  describe("when a test calls requestDelivery", () => {
    /** @scenario "A test may call requestDelivery directly" */
    it("reports nothing", () => {
      const code = "await webhooks.requestDelivery({ destinationId: 'endpoint-1' });";

      expect(report(code, TEST)).toEqual([]);
    });
  });
});
