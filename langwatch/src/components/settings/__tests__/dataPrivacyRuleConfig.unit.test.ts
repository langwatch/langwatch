import { describe, expect, it } from "vitest";
import {
  type ContentCategory,
  type DataPrivacyConfig,
  type Disposition,
  PLATFORM_DEFAULT_DATA_PRIVACY,
  type ResolvedDataPrivacy,
} from "~/server/data-privacy/dataPrivacy.types";
import {
  audienceConfig,
  buildRuleConfig,
  configsEqual,
  configToFormState,
  inheritedFormState,
  isEmptyRuleConfig,
  type RuleAudience,
  ruleSummary,
  type TouchedControls,
  touchedFromConfig,
} from "../dataPrivacyRuleConfig";

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

/**
 * The drawer only persists controls the user touched. By default this helper
 * derives "touched" from anything set away from a platform default, mirroring
 * the pre-fix behaviour, so a plain `build()` still produces an empty config.
 * Pass `touched` explicitly to exercise an override back to a default-looking
 * value (e.g. capturing over an inherited drop).
 */
function build({
  disp = {},
  audience = "admins" as RuleAudience,
  piiLevel = "essential" as const,
  secretsEnabled = true,
  touched,
}: {
  disp?: Partial<Record<ContentCategory, Disposition>>;
  audience?: RuleAudience;
  piiLevel?: "disabled" | "essential" | "strict";
  secretsEnabled?: boolean;
  touched?: TouchedControls;
} = {}) {
  const merged = dispositions(disp);
  const derived: TouchedControls = touched ?? {
    categories: Object.fromEntries(
      (Object.keys(merged) as ContentCategory[])
        .filter((c) => merged[c] !== "capture")
        .map((c) => [c, true]),
    ),
    pii: piiLevel !== "essential",
    secrets: !secretsEnabled,
  };
  return buildRuleConfig({
    dispositions: merged,
    audience,
    piiLevel,
    secretsEnabled,
    touched: derived,
  });
}

function allTouched(overrides: Partial<TouchedControls> = {}): TouchedControls {
  return {
    categories: { input: true, output: true, system: true, tools: true },
    pii: true,
    secrets: true,
    ...overrides,
  };
}

describe("buildRuleConfig", () => {
  describe("given everything at the platform defaults and nothing touched", () => {
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
        build({ disp: { output: "restrict" }, audience: "admins" }).categories
          ?.output,
      ).toEqual({ disposition: "restrict", audience: { admins: true } });
      expect(
        build({ disp: { output: "restrict" }, audience: "allMembers" })
          .categories?.output,
      ).toEqual({ disposition: "restrict", audience: { allMembers: true } });
      expect(
        build({ disp: { output: "restrict" }, audience: "noOne" }).categories
          ?.output,
      ).toEqual({ disposition: "restrict", audience: {} });
    });
  });

  describe("given a non-default PII level or secrets off", () => {
    it("includes pii only when not essential and secrets only when off", () => {
      expect(build({ piiLevel: "strict" }).pii).toEqual({ level: "strict" });
      expect(build({ piiLevel: "essential" }).pii).toBeUndefined();
      expect(build({ secretsEnabled: false }).secrets).toEqual({
        enabled: false,
      });
      expect(build({ secretsEnabled: true }).secrets).toBeUndefined();
    });
  });

  describe("given a touched control left at a default-looking value", () => {
    describe("when a category is touched to capture over an inherited drop", () => {
      it("persists the capture disposition explicitly instead of omitting it", () => {
        const config = build({
          disp: { input: "capture" },
          touched: { categories: { input: true }, pii: false, secrets: false },
        });
        expect(config.categories?.input).toEqual({ disposition: "capture" });
        expect(isEmptyRuleConfig(config)).toBe(false);
      });
    });

    describe("when PII is touched to essential over an inherited strict", () => {
      it("persists the essential level explicitly", () => {
        const config = build({
          piiLevel: "essential",
          touched: { categories: {}, pii: true, secrets: false },
        });
        expect(config.pii).toEqual({ level: "essential" });
        expect(isEmptyRuleConfig(config)).toBe(false);
      });
    });

    describe("when secrets are touched back on over an inherited off", () => {
      it("persists secrets enabled explicitly", () => {
        const config = build({
          secretsEnabled: true,
          touched: { categories: {}, pii: false, secrets: true },
        });
        expect(config.secrets).toEqual({ enabled: true });
        expect(isEmptyRuleConfig(config)).toBe(false);
      });
    });

    describe("when only some controls are touched", () => {
      it("omits the untouched ones so they keep inheriting", () => {
        const config = build({
          disp: { input: "capture", output: "drop" },
          piiLevel: "essential",
          secretsEnabled: true,
          touched: { categories: { input: true }, pii: false, secrets: false },
        });
        expect(config.categories?.input).toEqual({ disposition: "capture" });
        expect(config.categories?.output).toBeUndefined();
        expect(config.pii).toBeUndefined();
        expect(config.secrets).toBeUndefined();
      });
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

describe("touchedFromConfig", () => {
  describe("given a config that sets some fields", () => {
    it("marks exactly the present fields as touched", () => {
      const touched = touchedFromConfig({
        categories: { input: { disposition: "drop" } },
        pii: { level: "strict" },
      });
      expect(touched.categories.input).toBe(true);
      expect(touched.categories.output).toBeUndefined();
      expect(touched.pii).toBe(true);
      expect(touched.secrets).toBe(false);
    });
  });

  describe("given a config and a round-trip back through buildRuleConfig", () => {
    it("rebuilds the same config from its form state", () => {
      const original: DataPrivacyConfig = {
        categories: {
          input: { disposition: "capture" },
          output: { disposition: "restrict", audience: { allMembers: true } },
        },
        secrets: { enabled: true },
      };
      const form = configToFormState(original);
      const rebuilt = buildRuleConfig({
        ...form,
        touched: touchedFromConfig(original),
      });
      expect(configsEqual(rebuilt, original)).toBe(true);
    });
  });
});

describe("inheritedFormState", () => {
  function resolved(
    overrides: Partial<ResolvedDataPrivacy> = {},
  ): ResolvedDataPrivacy {
    return {
      ...PLATFORM_DEFAULT_DATA_PRIVACY,
      categories: {
        ...PLATFORM_DEFAULT_DATA_PRIVACY.categories,
        ...overrides.categories,
      },
      pii: overrides.pii ?? PLATFORM_DEFAULT_DATA_PRIVACY.pii,
      secrets: overrides.secrets ?? PLATFORM_DEFAULT_DATA_PRIVACY.secrets,
      customDropKeys:
        overrides.customDropKeys ??
        PLATFORM_DEFAULT_DATA_PRIVACY.customDropKeys,
    };
  }

  describe("given the current project scope under a restrictive parent", () => {
    it("seeds the form from the resolved effective so the parent restriction shows", () => {
      const effective = resolved({
        categories: {
          ...PLATFORM_DEFAULT_DATA_PRIVACY.categories,
          input: {
            disposition: "drop",
            audience: {
              admins: false,
              allMembers: false,
              groupIds: [],
              departmentIds: [],
            },
          },
        },
        pii: { level: "strict" },
        secrets: { enabled: false, customPatterns: [] },
      });

      const form = inheritedFormState({
        effective,
        isCurrentProjectScope: true,
      });

      expect(form.dispositions.input).toBe("drop");
      expect(form.piiLevel).toBe("strict");
      expect(form.secretsEnabled).toBe(false);
    });
  });

  describe("given any other scope", () => {
    it("falls back to the platform defaults", () => {
      const effective = resolved({
        categories: {
          ...PLATFORM_DEFAULT_DATA_PRIVACY.categories,
          input: {
            disposition: "drop",
            audience: {
              admins: false,
              allMembers: false,
              groupIds: [],
              departmentIds: [],
            },
          },
        },
      });

      const form = inheritedFormState({
        effective,
        isCurrentProjectScope: false,
      });

      expect(form.dispositions.input).toBe("capture");
      expect(form.piiLevel).toBe("essential");
      expect(form.secretsEnabled).toBe(true);
    });
  });
});

describe("configsEqual", () => {
  it("ignores key ordering and detects real differences", () => {
    expect(
      configsEqual(
        { pii: { level: "strict" }, secrets: { enabled: false } },
        { secrets: { enabled: false }, pii: { level: "strict" } },
      ),
    ).toBe(true);
    expect(
      configsEqual(
        { pii: { level: "strict" } },
        { pii: { level: "disabled" } },
      ),
    ).toBe(false);
    expect(configsEqual({}, {})).toBe(true);
  });
});

describe("ruleSummary", () => {
  it("summarizes a mixed rule and reads cleanly when nothing is set", () => {
    expect(
      ruleSummary(
        build({
          disp: { input: "drop", output: "restrict" },
          piiLevel: "strict",
        }),
      ),
    ).toBe("Input drop · Output restrict · PII Strict");
    expect(ruleSummary(build({ secretsEnabled: false }))).toBe("Secrets off");
    expect(ruleSummary(build())).toBe("No changes");
  });

  describe("given an explicit capture / essential / secrets-on override", () => {
    it("lists the override instead of reading as no change", () => {
      const config = buildRuleConfig({
        dispositions: dispositions({ input: "capture" }),
        audience: "admins",
        piiLevel: "essential",
        secretsEnabled: true,
        touched: allTouched(),
      });
      expect(ruleSummary(config)).toBe(
        "Input captured · Output captured · System instructions captured · Tool calls captured · PII Essential · Secrets on",
      );
    });
  });
});
