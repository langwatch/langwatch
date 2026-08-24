import { describe, expect, it } from "vitest";
import {
  safeParseDestinationConfig,
  validateThresholdConfig,
} from "../src/anomaly-rule";
import { isGovernanceOriginTrace } from "../src/governance-attributes";
import {
  getStarterTemplate,
  isOttlEnabledSourceType,
} from "../src/ingestion-source";
import {
  ottlTransformInputSchema,
  ottlValidationResultSchema,
} from "../src/ottl";
import {
  normalizedPullEventSchema,
  pulledUsageHintSchema,
} from "../src/puller";

describe("governance backend contract", () => {
  it("accepts HTTPS destinations and quarantines malformed legacy rows", () => {
    expect(
      safeParseDestinationConfig({
        destinations: [{ type: "webhook", url: "https://example.test/hook" }],
      }).ok,
    ).toBe(true);
    expect(
      safeParseDestinationConfig({
        destinations: [{ type: "webhook", url: "http://example.test/hook" }],
      }).ok,
    ).toBe(false);
  });

  it("keeps preview rule types explicit and rejects unknown types", () => {
    expect(
      validateThresholdConfig({ ruleType: "rate_limit", config: {} }),
    ).toBeNull();
    expect(() =>
      validateThresholdConfig({ ruleType: "typo", config: {} }),
    ).toThrow('Unsupported ruleType "typo"');
  });

  it("normalizes pull money as a decimal string", () => {
    const event = normalizedPullEventSchema.parse({
      source_event_id: "event",
      event_timestamp: "2026-08-24T00:00:00.000Z",
      actor: "actor@example.test",
      action: "completion",
      target: "model",
      cost_usd: 0.000_000_001,
      raw_payload: "{}",
    });
    expect(event.cost_usd).toBe("1e-9");
    expect(event.tokens_input).toBe(0);
  });

  it("requires provider-reported usage to declare whether its cost is exact", () => {
    expect(
      pulledUsageHintSchema.safeParse({
        costBasis: "provider_reported",
        dimensions: { workspaceId: "workspace" },
      }).success,
    ).toBe(false);
    expect(
      pulledUsageHintSchema.safeParse({
        costBasis: "provider_reported",
        costStatus: "exact",
        dimensions: { workspaceId: "workspace" },
      }).success,
    ).toBe(true);
  });

  it("recognizes governance traces by the canonical origin attribute", () => {
    expect(
      isGovernanceOriginTrace({ "langwatch.origin.kind": "ingestion_source" }),
    ).toBe(true);
    expect(isGovernanceOriginTrace(undefined)).toBe(false);
  });

  it("only enables OTTL for generic OTLP sources", () => {
    expect(isOttlEnabledSourceType("otel_generic")).toBe(true);
    expect(isOttlEnabledSourceType("claude_code")).toBe(false);
    expect(getStarterTemplate("otel_generic")).toEqual([]);
  });

  it("validates the portable OTTL gateway boundary", () => {
    expect(
      ottlTransformInputSchema.safeParse({
        sourceId: "source",
        kind: "log",
        encoding: "proto",
        payloadB64: "AQID",
        statements: ['set(attributes["service.name"], "example")'],
      }).success,
    ).toBe(true);
    expect(
      ottlValidationResultSchema.safeParse({
        status: "deferred",
        reason: "unknown",
      }).success,
    ).toBe(false);
  });
});
