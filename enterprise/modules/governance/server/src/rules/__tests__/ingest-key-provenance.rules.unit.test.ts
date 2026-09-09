import { describe, expect, it } from "vitest";
import { applyOtlpReceiverPolicy, type OtlpReceiverRequest } from "@langwatch/otlp";
import {
  buildIngestKeyReceiverPolicies,
  originForIngestSourceType,
} from "../ingest-key-provenance.rules.ts";

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
  ])("classifies coding source %s", (sourceType) => {
    expect(originForIngestSourceType(sourceType)).toBe("coding_agent");
  });

  it.each(["claude_cowork", "otel_generic", "workato", "unknown_tool", "constructor", "__proto__"])(
    "classifies other source %s without prototype inheritance",
    (sourceType) => {
      expect(originForIngestSourceType(sourceType)).toBe("ai_tool");
    },
  );

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
      applyOtlpReceiverPolicy(request, signal, "key_real", policies[signal]);
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
        { scope: { name: "customer.service" } },
        {},
      ];
      const request: OtlpReceiverRequest = {
        resourceSpans: [{ scopeSpans: groups }, { scopeSpans: [{}] }],
        resourceMetrics: [{ scopeMetrics: groups }, { scopeMetrics: [{}] }],
      };
      const result = applyOtlpReceiverPolicy(request, signal, "key_real", policy);
      expect(result.droppedScopes).toBe(3);
      const scopes =
        signal === "traces"
          ? request.resourceSpans?.[0]?.scopeSpans
          : request.resourceMetrics?.[0]?.scopeMetrics;
      expect(scopes?.map((scope) => scope?.scope?.name)).toEqual([
        "github.copilot",
        "@github/copilot",
      ]);
      expect(signal === "traces" ? request.resourceSpans : request.resourceMetrics).toHaveLength(1);
    },
  );

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
    expect(applyOtlpReceiverPolicy(request, "traces", "key", other.traces).droppedScopes).toBe(0);
    expect(applyOtlpReceiverPolicy(request, "logs", "key", vscode.logs).droppedScopes).toBe(0);
    expect(request.resourceSpans?.[0]?.scopeSpans?.[0]?.scope?.name).toBe("custom");
    expect(request.resourceLogs?.[0]?.scopeLogs?.[0]?.scope?.name).toBe("custom");
  });
});
