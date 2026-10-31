import { applyOtlpReceiverPolicy, type OtlpReceiverRequest } from "@langwatch/otlp";
import { describe, expect, it } from "vitest";

import {
  buildIngestKeyReceiverPolicies,
  originForIngestSourceType,
} from "../features/ingestion/otlp-receiver-policy.ts";

const identity = { organizationId: "org_1", sourceType: "claude_code" };

function attributes(request: OtlpReceiverRequest, signal: "traces" | "logs" | "metrics") {
  const resources = {
    traces: request.resourceSpans,
    logs: request.resourceLogs,
    metrics: request.resourceMetrics,
  }[signal];
  return (resources ?? []).map((resource) =>
    Object.fromEntries(
      (resource?.resource?.attributes ?? []).map((attribute) => [
        attribute.key,
        attribute.value?.stringValue,
      ]),
    ),
  );
}

describe("Governance receiver policy", () => {
  it.each([
    "claude_code",
    "codex",
    "gemini",
    "opencode",
    "cursor",
    "copilot_cli",
    "copilot_app",
    "copilot_vscode",
    "pi_cli",
  ])("classifies coding source %s", (sourceType) => {
    expect(originForIngestSourceType(sourceType)).toBe("coding_agent");
  });

  it.each(["claude_cowork", "otel_generic", "workato", "unknown_tool", "constructor", "__proto__"])(
    "classifies other source %s without prototype inheritance",
    (sourceType) => {
      expect(originForIngestSourceType(sourceType)).toBe("ai_tool");
    },
  );

  /** @scenario "Receiver identity wins over sender and configured policy" */
  /** @scenario "Metrics retain the existing billing distinction" */
  it.each(["traces", "logs", "metrics"] as const)(
    "overwrites forged %s provenance and retains authenticated key identity",
    (signal) => {
      const policies = buildIngestKeyReceiverPolicies(identity, true);
      const group = {
        resource: {
          attributes: [
            { key: "langwatch.source", value: { stringValue: "forged" } },
            { key: "langwatch.source", value: { stringValue: "duplicate" } },
            { key: "langwatch.api_key.id", value: { stringValue: "secret" } },
            { key: "langwatch.origin", value: { stringValue: "forged" } },
            { key: "langwatch.organization_id", value: { stringValue: "other_org" } },
            { key: "langwatch.template.id", value: { stringValue: "foreign_template" } },
            { key: "langwatch.cost.non_billable", value: { stringValue: "forged" } },
            { key: "service.name", value: { stringValue: "kept" } },
          ],
        },
      };
      const request: OtlpReceiverRequest = {
        resourceSpans: [group, {}],
        resourceLogs: [group, {}],
        resourceMetrics: [group, {}],
      };
      applyOtlpReceiverPolicy({
        request: request,
        signal: signal,
        apiKeyId: "key_real",
        policy: policies[signal],
      });
      const rows = attributes(request, signal);
      const expectedBilling = { traces: "true", logs: "true", metrics: void 0 }[signal];

      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row).toMatchObject({
          "langwatch.source": "claude_code",
          "langwatch.origin": "coding_agent",
          "langwatch.organization_id": "org_1",
          "langwatch.api_key.id": "key_real",
        });
        expect(row).not.toHaveProperty("langwatch.template.id");
        expect(row["langwatch.cost.non_billable"]).toBe(expectedBilling);
      }
      expect(rows[0]).toHaveProperty("service.name", "kept");
    },
  );

  /** @scenario "Metrics retain the existing billing distinction" */
  it.each([true, false])(
    "prices traces and logs with bundled=%s while metrics remain unpriced",
    (nonBillable) => {
      const policies = buildIngestKeyReceiverPolicies(
        { ...identity, templateId: "template_1" },
        nonBillable,
      );
      for (const signal of ["traces", "logs"] as const) {
        expect(policies[signal].resourceAttributes).toContainEqual({
          key: "langwatch.cost.non_billable",
          value: { stringValue: String(nonBillable) },
        });
        expect(policies[signal].resourceAttributes).toContainEqual({
          key: "langwatch.template.id",
          value: { stringValue: "template_1" },
        });
      }
      expect(
        policies.metrics.resourceAttributes.some(
          (attribute) => attribute.key === "langwatch.cost.non_billable",
        ),
      ).toBe(false);
    },
  );

  /** @scenario Foreign OTLP traffic on a copilot_vscode key is dropped at the receiver */
  /** @scenario "VS Code policy excludes inherited telemetry" */
  /** @scenario "Copilot Chat's copilot-chat scope counts as Copilot's own on a copilot_vscode key" */
  it.each(["traces", "metrics"] as const)(
    "filters foreign VS Code %s scopes and removes empty groups",
    (signal) => {
      const policy = buildIngestKeyReceiverPolicies(
        { ...identity, sourceType: "copilot_vscode" },
        true,
      )[signal];
      const groups = [
        { scope: { name: "github.copilot" } },
        { scope: { name: "@github/copilot" } },
        { scope: { name: "copilot-chat" } },
        { scope: { name: "customer.service" } },
        {},
      ];
      const request: OtlpReceiverRequest = {
        resourceSpans: [{ scopeSpans: groups }, { scopeSpans: [{}] }],
        resourceMetrics: [{ scopeMetrics: groups }, { scopeMetrics: [{}] }],
      };
      const result = applyOtlpReceiverPolicy({
        request: request,
        signal: signal,
        apiKeyId: "key_real",
        policy: policy,
      });
      expect(result.droppedScopes).toBe(3);
      const scopes =
        signal === "traces"
          ? request.resourceSpans?.[0]?.scopeSpans
          : request.resourceMetrics?.[0]?.scopeMetrics;
      expect(scopes?.map((scope) => scope?.scope?.name)).toEqual([
        "github.copilot",
        "@github/copilot",
        "copilot-chat",
      ]);
      expect(signal === "traces" ? request.resourceSpans : request.resourceMetrics).toHaveLength(1);
    },
  );

  /** @scenario "Copilot Chat's copilot-chat scope counts as Copilot's own on a copilot_vscode key" */
  it.each(["copilot_cli", "copilot_app"])(
    "applies no scope filter on a %s key, so a copilot-chat span is kept",
    (sourceType) => {
      const policy = buildIngestKeyReceiverPolicies({ ...identity, sourceType }, true).traces;
      const request: OtlpReceiverRequest = {
        resourceSpans: [
          { scopeSpans: [{ scope: { name: "copilot-chat" } }, { scope: { name: "custom" } }] },
        ],
      };

      expect(policy.allowedTraceScopeNames).toBeUndefined();
      expect(
        applyOtlpReceiverPolicy({ request, signal: "traces", apiKeyId: "key", policy })
          .droppedScopes,
      ).toBe(0);
      expect(request.resourceSpans?.[0]?.scopeSpans?.map((scope) => scope?.scope?.name)).toEqual([
        "copilot-chat",
        "custom",
      ]);
    },
  );

  /** @scenario "VS Code policy excludes inherited telemetry" */
  it("keeps unrelated source scopes and does not apply the VS Code restriction to logs", () => {
    const other = buildIngestKeyReceiverPolicies(identity, true);
    const vscode = buildIngestKeyReceiverPolicies(
      { ...identity, sourceType: "copilot_vscode" },
      true,
    );
    const request: OtlpReceiverRequest = {
      resourceSpans: [{ scopeSpans: [{ scope: { name: "custom" } }] }],
      resourceLogs: [{ scopeLogs: [{ scope: { name: "custom" } }] }],
    };
    expect(
      applyOtlpReceiverPolicy({
        request: request,
        signal: "traces",
        apiKeyId: "key",
        policy: other.traces,
      }).droppedScopes,
    ).toBe(0);
    expect(
      applyOtlpReceiverPolicy({
        request: request,
        signal: "logs",
        apiKeyId: "key",
        policy: vscode.logs,
      }).droppedScopes,
    ).toBe(0);
    expect(request.resourceSpans?.[0]?.scopeSpans?.[0]?.scope?.name).toBe("custom");
    expect(request.resourceLogs?.[0]?.scopeLogs?.[0]?.scope?.name).toBe("custom");
  });

  /** One pi harness span, as pi's own exporter sends it. */
  function piHarnessRun(): OtlpReceiverRequest {
    return {
      resourceSpans: [
        {
          scopeSpans: [
            {
              scope: { name: "@earendil-works/pi-agent-core" },
              spans: [{ attributes: [{ key: "pi.session.id", value: { stringValue: "s-1" } }] }],
            },
          ],
        },
      ],
    };
  }

  /** @scenario "A pi span ingested under its own key carries the coding-agent origin" */
  it("stamps a pi span ingested on a pi_cli key as coding-agent activity", () => {
    const policies = buildIngestKeyReceiverPolicies(
      { organizationId: "org_1", sourceType: "pi_cli" },
      false,
    );
    const request = piHarnessRun();

    const result = applyOtlpReceiverPolicy({
      request: request,
      signal: "traces",
      apiKeyId: "key_pi",
      policy: policies.traces,
    });

    expect(attributes(request, "traces")[0]).toMatchObject({
      "langwatch.source": "pi_cli",
      "langwatch.origin": "coding_agent",
      "langwatch.organization_id": "org_1",
      "langwatch.api_key.id": "key_pi",
    });
    // pi exports only its own spans, so no scope restriction is applied and none is dropped.
    expect(policies.traces.allowedTraceScopeNames).toBeUndefined();
    expect(result.droppedScopes).toBe(0);
  });

  /** @scenario "pi spans sent with another source's key do not pass as pi's" */
  it("rewrites a forged pi source on an unrelated source's key", () => {
    const policies = buildIngestKeyReceiverPolicies(
      { organizationId: "org_1", sourceType: "otel_generic" },
      false,
    );
    const request = piHarnessRun();
    const group = request.resourceSpans?.[0];
    if (group) {
      group.resource = {
        attributes: [
          { key: "langwatch.source", value: { stringValue: "pi_cli" } },
          { key: "langwatch.origin", value: { stringValue: "coding_agent" } },
        ],
      };
    }

    applyOtlpReceiverPolicy({
      request: request,
      signal: "traces",
      apiKeyId: "key_other",
      policy: policies.traces,
    });

    expect(attributes(request, "traces")[0]).toMatchObject({
      "langwatch.source": "otel_generic",
      "langwatch.origin": "ai_tool",
    });
  });
});
