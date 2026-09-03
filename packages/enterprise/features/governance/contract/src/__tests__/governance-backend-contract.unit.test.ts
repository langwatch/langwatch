import { describe, expect, it } from "vitest";
import {
  anomalyRuleSchema,
  createAnomalyRuleInputSchema,
  safeParseDestinationConfig,
  validateThresholdConfig,
} from "../anomaly-rule";
import { isGovernanceOriginTrace } from "../governance-attributes";
import { departmentSchema } from "../department";
import { getStarterTemplate, isOttlEnabledSourceType } from "../ingestion-source";
import { ottlTransformInputSchema, ottlValidationResultSchema } from "../ottl";
import { normalizedPullEventSchema, pulledUsageHintSchema } from "../puller";
import { quarantineFillInputSchema } from "../quarantine-fill";

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
    expect(validateThresholdConfig({ ruleType: "rate_limit", config: {} })).toBeNull();
    expect(() => validateThresholdConfig({ ruleType: "typo", config: {} })).toThrow(
      'Unsupported ruleType "typo"',
    );
  });

  it("validates portable anomaly rule commands and records with Zod 4", () => {
    expect(
      createAnomalyRuleInputSchema.safeParse({
        organizationId: "organization",
        name: "Spend spike",
        severity: "warning",
        ruleType: "spend_spike",
        scope: "organization",
        scopeId: "organization",
        actorUserId: "user",
      }).success,
    ).toBe(true);
    expect(
      anomalyRuleSchema.safeParse({
        id: "rule",
        organizationId: "organization",
        name: "Spend spike",
        description: null,
        severity: "urgent",
        ruleType: "spend_spike",
        scope: "organization",
        scopeId: "organization",
        thresholdConfig: {},
        destinationConfig: {},
        status: "active",
        archivedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdById: "user",
      }).success,
    ).toBe(false);
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

  it("applies the portable quarantine-fill defaults", () => {
    expect(quarantineFillInputSchema.parse({ organizationId: "organization" })).toEqual({
      organizationId: "organization",
      windowSeconds: 60,
      threshold: 100,
    });
  });

  it("recognizes governance traces by the canonical origin attribute", () => {
    expect(isGovernanceOriginTrace({ "langwatch.origin.kind": "ingestion_source" })).toBe(
      true,
    );
    expect(isGovernanceOriginTrace(undefined)).toBe(false);
  });

  it("keeps department records portable", () => {
    expect(
      departmentSchema.safeParse({
        id: "department",
        name: "Engineering",
        organizationId: "organization",
        createdAt: new Date(),
        updatedAt: new Date(),
      }).success,
    ).toBe(true);
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
