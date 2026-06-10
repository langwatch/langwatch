import { describe, expect, it } from "vitest";

import {
  audienceConfig,
  buildRuleConfig,
  isEmptyRuleConfig,
  ruleSummary,
  type RuleAudience,
} from "../dataPrivacyRuleConfig";
import type { ContentCategory, Disposition } from "~/server/data-privacy/dataPrivacy.types";

function dispositions(
  overrides: Partial<Record<ContentCategory, Disposition>> = {},
): Record<ContentCategory, Disposition> {
  return {
    input: "capture",
    output: "capture",
    system: "capture",
    tools: "capture",
    ...overrides,
  };
}

function build({
  disp = {},
  audience = "admins" as RuleAudience,
  piiLevel = "essential" as const,
  secretsEnabled = true,
}: {
  disp?: Partial<Record<ContentCategory, Disposition>>;
  audience?: RuleAudience;
  piiLevel?: "disabled" | "essential" | "strict";
  secretsEnabled?: boolean;
} = {}) {
  return buildRuleConfig({
    dispositions: dispositions(disp),
    audience,
    piiLevel,
    secretsEnabled,
  });
}

describe("buildRuleConfig", () => {
  describe("given everything at the platform defaults", () => {
    it("produces an empty config that changes nothing", () => {
      const config = build();
      expect(config).toEqual({});
      expect(isEmptyRuleConfig(config)).toBe(true);
    });
  });

  describe("given a dropped category", () => {
    it("includes only the dropped category and omits the captured ones", () => {
      const config = build({ disp: { input: "drop" } });
      expect(config.categories?.input).toEqual({ disposition: "drop" });
      expect(config.categories?.output).toBeUndefined();
      expect(config.categories?.system).toBeUndefined();
      expect(config.categories?.tools).toBeUndefined();
    });
  });

  describe("given a restricted category", () => {
    it("attaches the chosen audience", () => {
      expect(
        build({ disp: { output: "restrict" }, audience: "admins" }).categories?.output,
      ).toEqual({ disposition: "restrict", audience: { admins: true } });
      expect(
        build({ disp: { output: "restrict" }, audience: "allMembers" }).categories
          ?.output,
      ).toEqual({ disposition: "restrict", audience: { allMembers: true } });
      expect(
        build({ disp: { output: "restrict" }, audience: "noOne" }).categories?.output,
      ).toEqual({ disposition: "restrict", audience: {} });
    });
  });

  describe("given a non-default PII level or secrets off", () => {
    it("includes pii only when not essential and secrets only when off", () => {
      expect(build({ piiLevel: "strict" }).pii).toEqual({ level: "strict" });
      expect(build({ piiLevel: "essential" }).pii).toBeUndefined();
      expect(build({ secretsEnabled: false }).secrets).toEqual({ enabled: false });
      expect(build({ secretsEnabled: true }).secrets).toBeUndefined();
    });
  });
});

describe("audienceConfig", () => {
  it("maps the audience choices", () => {
    expect(audienceConfig("admins")).toEqual({ admins: true });
    expect(audienceConfig("allMembers")).toEqual({ allMembers: true });
    expect(audienceConfig("noOne")).toEqual({});
  });
});

describe("ruleSummary", () => {
  it("summarizes a mixed rule and reads cleanly when nothing changed", () => {
    expect(
      ruleSummary(build({ disp: { input: "drop", output: "restrict" }, piiLevel: "strict" })),
    ).toBe("Input drop · Output restrict · PII Strict");
    expect(ruleSummary(build({ secretsEnabled: false }))).toBe("Secrets off");
    expect(ruleSummary(build())).toBe("No changes");
  });
});
