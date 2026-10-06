/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from "vitest";

import { SOURCE_TYPE_OPTIONS } from "../../../../features/ingestion-sources/model/ingestion-source-catalog.ts";
import {
  buildClaudeCompliancePullConfig,
  PARSER_FIELDS,
  SOURCE_TYPES_WITH_PULL_CONFIG_BUILDER,
  type ComposerState,
} from "../governance-inventory.screen.tsx";

function composer(parserConfig: Record<string, string>): ComposerState {
  return {
    sourceType: "claude_compliance",
    name: "Claude compliance",
    description: "",
    parserConfig,
    ottlStatements: [],
    pullSchedule: "",
    traceProjectId: null,
  };
}

describe("given a Claude compliance source whose admin entered a workspace key", () => {
  describe("when the pull config is assembled for saving", () => {
    /** @scenario "The Claude compliance workspace key reaches its adapter as the token it reads" */
    it("files the key under the credentials as the token, not under the old name", () => {
      const config = buildClaudeCompliancePullConfig(
        composer({ credentialsToken: "sk-ant-workspace" }),
      );

      expect(config).toMatchObject({
        adapter: "claude_compliance",
        credentials: { token: "sk-ant-workspace" },
      });
      expect(JSON.stringify(config)).not.toContain("workspaceApiKey");
    });
  });

  describe("when the admin entered no key", () => {
    it("builds nothing rather than a config that sends an unresolved template", () => {
      expect(buildClaudeCompliancePullConfig(composer({}))).toBeNull();
    });
  });
});

describe("given the source types that collect a secret in their setup form", () => {
  const secretSourceTypes = Object.entries(PARSER_FIELDS)
    .filter(([, fields]) => fields.some((field) => field.secret))
    .map(([sourceType]) => sourceType)
    .filter((sourceType) => {
      const option = SOURCE_TYPE_OPTIONS.find((candidate) => candidate.value === sourceType);
      return !option?.retired;
    });

  // A retired type owes no builder; a merely hidden one does (see SourceTypeOption.retired).
  /** @scenario Every source type that collects a secret can put it back where its adapter reads it */
  it("gives each of them a pull-config builder, hidden from the picker or not", () => {
    expect(secretSourceTypes.length).toBeGreaterThan(0);
    const builders: readonly string[] = SOURCE_TYPES_WITH_PULL_CONFIG_BUILDER;

    expect(secretSourceTypes.filter((sourceType) => !builders.includes(sourceType))).toEqual([]);
  });
});
