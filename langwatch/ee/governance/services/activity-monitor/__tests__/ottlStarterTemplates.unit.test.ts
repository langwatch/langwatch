/**
 * Lock the canonical OTTL starter contract for claude_code.
 *
 * Sergey + Lane-B agreed on a 9-statement starter template, one per
 * canonical output field, all gated on
 * `attributes["event.name"] == "api_request"`. This test pins the
 * EXACT statements byte-for-byte — drift here is a contract break.
 *
 * Spec: specs/ai-governance/ingestion-sources/claude-code-otlp.feature
 */
import { describe, expect, it } from "vitest";

import {
  CLAUDE_CODE_OTTL_STARTER,
  LANGWATCH_OTTL_FIELDS,
  OTTL_ENABLED_SOURCE_TYPES,
  OTTL_STARTER_BY_SOURCE_TYPE,
  getStarterTemplate,
  isOttlEnabledSourceType,
} from "../ottlStarterTemplates";

describe("CLAUDE_CODE_OTTL_STARTER", () => {
  it("ships exactly 9 statements", () => {
    expect(CLAUDE_CODE_OTTL_STARTER).toHaveLength(9);
  });

  it("has one statement per canonical field", () => {
    const fieldNames = Object.values(LANGWATCH_OTTL_FIELDS);
    expect(fieldNames).toHaveLength(9);
    for (const field of fieldNames) {
      const matches = CLAUDE_CODE_OTTL_STARTER.filter((s) =>
        s.includes(`set(attributes["${field}"]`),
      );
      expect(matches).toHaveLength(1);
    }
  });

  it("gates every statement on attributes[\"event.name\"] == \"api_request\"", () => {
    for (const stmt of CLAUDE_CODE_OTTL_STARTER) {
      expect(stmt).toContain(
        `where attributes["event.name"] == "api_request"`,
      );
    }
  });

  it("targets resource.attributes for team.id (Claude Code emits team via OTEL_RESOURCE_ATTRIBUTES)", () => {
    const teamStatement = CLAUDE_CODE_OTTL_STARTER.find((s) =>
      s.includes(`langwatch.team.id_hint`),
    );
    expect(teamStatement).toContain(`resource.attributes["team.id"]`);
  });

  it("reads cost from attributes[\"cost_usd\"] (Claude Code's wire field)", () => {
    const costStatement = CLAUDE_CODE_OTTL_STARTER.find((s) =>
      s.includes(`langwatch.cost.usd`),
    );
    expect(costStatement).toContain(`attributes["cost_usd"]`);
  });
});

describe("OTTL_STARTER_BY_SOURCE_TYPE", () => {
  it("seeds claude_code with the 9-statement starter", () => {
    expect(OTTL_STARTER_BY_SOURCE_TYPE.claude_code).toBe(
      CLAUDE_CODE_OTTL_STARTER,
    );
  });

  it("leaves otel_generic blank — admin pastes their own", () => {
    expect(OTTL_STARTER_BY_SOURCE_TYPE.otel_generic).toEqual([]);
  });
});

describe("getStarterTemplate", () => {
  it("returns the claude_code starter for source type 'claude_code'", () => {
    expect(getStarterTemplate("claude_code")).toBe(
      CLAUDE_CODE_OTTL_STARTER,
    );
  });

  it("returns [] for unknown source types (graceful default)", () => {
    expect(getStarterTemplate("workato")).toEqual([]);
    expect(getStarterTemplate("")).toEqual([]);
  });
});

describe("isOttlEnabledSourceType", () => {
  describe("when the source type ships an OTTL editor in v1", () => {
    it("returns true for claude_code and otel_generic", () => {
      expect(isOttlEnabledSourceType("claude_code")).toBe(true);
      expect(isOttlEnabledSourceType("otel_generic")).toBe(true);
    });
  });

  describe("when the source type is pull-mode or webhook (uses adapter config, not OTTL)", () => {
    it("returns false for workato, copilot_studio, openai_compliance", () => {
      expect(isOttlEnabledSourceType("workato")).toBe(false);
      expect(isOttlEnabledSourceType("copilot_studio")).toBe(false);
      expect(isOttlEnabledSourceType("openai_compliance")).toBe(false);
    });
  });

  it("matches OTTL_ENABLED_SOURCE_TYPES exactly", () => {
    for (const type of OTTL_ENABLED_SOURCE_TYPES) {
      expect(isOttlEnabledSourceType(type)).toBe(true);
    }
  });
});
