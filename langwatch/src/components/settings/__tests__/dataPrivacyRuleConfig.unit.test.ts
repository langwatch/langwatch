import { describe, expect, it } from "vitest";

import {
  EMPTY_AUDIENCE,
  type ResolvedDataPrivacy,
} from "~/server/data-privacy/dataPrivacy.types";
import {
  ALL_MEMBERS_VALUE,
  applyAudienceSelection,
  type AudienceFormState,
  audienceConfig,
  audienceToSelection,
  buildRuleConfig,
  type CustomAttributeFormRow,
  configsEqual,
  configToFormState,
  EMPTY_AUDIENCE_FORM,
  inheritedFormState,
  isEmptyRuleConfig,
  ROLE_VALUES,
  type RuleFormState,
  ruleSummary,
  selectionToAudience,
  type TouchedControls,
  touchedFromConfig,
} from "../dataPrivacyRuleConfig";

const defaultDispositions: RuleFormState["dispositions"] = {
  input: "capture",
  output: "capture",
  system: "capture",
  tools: "capture",
};

const noTouch: TouchedControls = { categories: {}, pii: false, secrets: false };

function audience(partial: Partial<AudienceFormState> = {}): AudienceFormState {
  return { ...EMPTY_AUDIENCE_FORM, ...partial };
}

function build({
  dispositions = defaultDispositions,
  aud = audience({ admins: true }),
  piiLevel = "essential" as const,
  secretsEnabled = true,
  secretsPatterns = [] as string[],
  customAttributes = [] as CustomAttributeFormRow[],
  touched = noTouch,
}: {
  dispositions?: RuleFormState["dispositions"];
  aud?: AudienceFormState;
  piiLevel?: RuleFormState["piiLevel"];
  secretsEnabled?: boolean;
  secretsPatterns?: string[];
  customAttributes?: CustomAttributeFormRow[];
  touched?: TouchedControls;
}) {
  return buildRuleConfig({
    dispositions,
    audience: aud,
    piiLevel,
    secretsEnabled,
    secretsPatterns,
    customAttributes,
    touched,
  });
}

function resolved(
  overrides: Partial<ResolvedDataPrivacy> = {},
): ResolvedDataPrivacy {
  const cat = () => ({
    disposition: "capture" as const,
    audience: { ...EMPTY_AUDIENCE },
  });
  return {
    categories: { input: cat(), output: cat(), system: cat(), tools: cat() },
    pii: { level: "essential" },
    secrets: { enabled: true, customPatterns: [] },
    customAttributes: [],
    ...overrides,
  };
}

describe("buildRuleConfig", () => {
  describe("given everything at the platform defaults and nothing touched", () => {
    it("produces an empty config that changes nothing", () => {
      const config = build({});

      expect(isEmptyRuleConfig(config)).toBe(true);
    });
  });

  describe("given a dropped category", () => {
    it("includes only the dropped category and omits the untouched ones", () => {
      const config = build({
        dispositions: { ...defaultDispositions, input: "drop" },
        touched: { ...noTouch, categories: { input: true } },
      });

      expect(config.categories?.input).toEqual({ disposition: "drop" });
      expect(config.categories?.output).toBeUndefined();
    });
  });

  describe("given a restricted category", () => {
    it("attaches the full structured audience", () => {
      const config = build({
        dispositions: { ...defaultDispositions, output: "restrict" },
        aud: audience({
          viewers: true,
          projectOwner: true,
          groupIds: ["g1"],
        }),
        touched: { ...noTouch, categories: { output: true } },
      });

      expect(config.categories?.output).toEqual({
        disposition: "restrict",
        audience: {
          viewers: true,
          projectOwner: true,
          groupIds: ["g1"],
        },
      });
    });
  });

  describe("given custom attribute rows", () => {
    it("persists restrict rows with the rule audience and drop rows without one", () => {
      const config = build({
        aud: audience({ admins: true }),
        customAttributes: [
          { pattern: "app.billing.*", disposition: "restrict" },
          { pattern: "http.request.body", disposition: "drop" },
        ],
      });

      expect(config.customAttributes).toEqual([
        {
          pattern: "app.billing.*",
          disposition: "restrict",
          audience: { admins: true },
        },
        { pattern: "http.request.body", disposition: "drop" },
      ]);
    });

    it("drops empty and wildcard-only rows", () => {
      const config = build({
        customAttributes: [
          { pattern: "  ", disposition: "drop" },
          { pattern: "*", disposition: "drop" },
          { pattern: "ok.key", disposition: "drop" },
        ],
      });

      expect(config.customAttributes).toEqual([
        { pattern: "ok.key", disposition: "drop" },
      ]);
    });
  });

  describe("given custom secret patterns with secrets touched", () => {
    it("persists the trimmed patterns alongside the enabled flag", () => {
      const config = build({
        secretsPatterns: [" acme_live_[a-z0-9]+ ", ""],
        touched: { ...noTouch, secrets: true },
      });

      expect(config.secrets).toEqual({
        enabled: true,
        customPatterns: ["acme_live_[a-z0-9]+"],
      });
    });
  });

  describe("given a touched control left at a default-looking value", () => {
    describe("when a category is touched to capture over an inherited drop", () => {
      it("persists the capture disposition explicitly instead of omitting it", () => {
        const config = build({
          touched: { ...noTouch, categories: { input: true } },
        });

        expect(config.categories?.input).toEqual({ disposition: "capture" });
      });
    });

    describe("when PII is touched to essential over an inherited strict", () => {
      it("persists the essential level explicitly", () => {
        const config = build({ touched: { ...noTouch, pii: true } });

        expect(config.pii).toEqual({ level: "essential" });
      });
    });

    describe("when secrets are touched back on over an inherited off", () => {
      it("persists secrets enabled explicitly", () => {
        const config = build({ touched: { ...noTouch, secrets: true } });

        expect(config.secrets).toEqual({ enabled: true });
      });
    });
  });
});

describe("audienceConfig", () => {
  it("includes only the active audience dimensions", () => {
    expect(audienceConfig(audience({ admins: true }))).toEqual({
      admins: true,
    });
    expect(audienceConfig(audience({ allMembers: true }))).toEqual({
      allMembers: true,
    });
    expect(audienceConfig(audience())).toEqual({});
    expect(
      audienceConfig(audience({ projectOwner: true, groupIds: ["g1"] })),
    ).toEqual({ projectOwner: true, groupIds: ["g1"] });
  });
});

describe("configToFormState and touchedFromConfig", () => {
  describe("given a config with every kind of field", () => {
    const config = build({
      dispositions: { ...defaultDispositions, input: "restrict" },
      aud: audience({ projectOwner: true, groupIds: ["g1"] }),
      piiLevel: "strict",
      secretsEnabled: true,
      secretsPatterns: ["acme_[0-9]+"],
      customAttributes: [{ pattern: "app.token", disposition: "drop" }],
      touched: {
        categories: { input: true },
        pii: true,
        secrets: true,
      },
    });

    it("hydrates the form state back, including the structured audience", () => {
      const state = configToFormState(config);

      expect(state.dispositions.input).toBe("restrict");
      expect(state.audience.projectOwner).toBe(true);
      expect(state.audience.groupIds).toEqual(["g1"]);
      expect(state.piiLevel).toBe("strict");
      expect(state.secretsPatterns).toEqual(["acme_[0-9]+"]);
      expect(state.customAttributes).toEqual([
        { pattern: "app.token", disposition: "drop" },
      ]);
    });

    it("marks exactly the present fields as touched", () => {
      const touched = touchedFromConfig(config);

      expect(touched.categories).toEqual({ input: true });
      expect(touched.pii).toBe(true);
      expect(touched.secrets).toBe(true);
    });

    it("round-trips back to an equal config", () => {
      const state = configToFormState(config);
      const rebuilt = buildRuleConfig({
        dispositions: state.dispositions,
        audience: state.audience,
        piiLevel: state.piiLevel,
        secretsEnabled: state.secretsEnabled,
        secretsPatterns: state.secretsPatterns,
        customAttributes: state.customAttributes,
        touched: touchedFromConfig(config),
      });

      expect(configsEqual(rebuilt, config)).toBe(true);
    });
  });

  describe("given a config whose only restrict lives on an attribute rule", () => {
    it("seeds the audience from that rule", () => {
      const state = configToFormState({
        customAttributes: [
          {
            pattern: "app.billing.*",
            disposition: "restrict",
            audience: { viewers: true },
          },
        ],
      });

      expect(state.audience.viewers).toBe(true);
    });
  });
});

describe("inheritedFormState", () => {
  describe("given the current project scope under a restrictive parent", () => {
    it("seeds the form from the resolved effective so the parent restriction shows", () => {
      const state = inheritedFormState({
        effective: resolved({
          categories: {
            input: { disposition: "drop", audience: { ...EMPTY_AUDIENCE } },
            output: {
              disposition: "restrict",
              audience: { ...EMPTY_AUDIENCE, projectOwner: true },
            },
            system: { disposition: "capture", audience: { ...EMPTY_AUDIENCE } },
            tools: { disposition: "capture", audience: { ...EMPTY_AUDIENCE } },
          },
          pii: { level: "strict" },
        }),
        isCurrentProjectScope: true,
      });

      expect(state.dispositions.input).toBe("drop");
      expect(state.dispositions.output).toBe("restrict");
      expect(state.audience.projectOwner).toBe(true);
      expect(state.piiLevel).toBe("strict");
      expect(state.customAttributes).toEqual([]);
    });
  });

  describe("given any other scope", () => {
    it("falls back to the platform defaults", () => {
      const state = inheritedFormState({
        effective: resolved({ pii: { level: "strict" } }),
        isCurrentProjectScope: false,
      });

      expect(state.dispositions.input).toBe("capture");
      expect(state.piiLevel).toBe("essential");
      expect(state.secretsEnabled).toBe(true);
    });
  });
});

describe("ruleSummary", () => {
  it("lists categories, attribute rules, PII, secrets, and patterns", () => {
    const summary = ruleSummary({
      categories: { input: { disposition: "drop" } },
      pii: { level: "disabled" },
      secrets: { enabled: true, customPatterns: ["a", "b"] },
      customAttributes: [
        { pattern: "x.*", disposition: "drop" },
        { pattern: "y", disposition: "restrict", audience: {} },
      ],
    });

    expect(summary).toBe(
      "Input drop · 2 attribute rules · PII Disabled · Secrets on · 2 secret patterns",
    );
  });

  it("reads as no changes for an empty config", () => {
    expect(ruleSummary({})).toBe("No changes");
  });
});

describe("audience selection", () => {
  describe("when All members is picked over a narrower selection", () => {
    /** @scenario Picking All members replaces any narrower audience selection */
    it("collapses to All members alone and drops it again on a narrower pick", () => {
      const narrower = [ROLE_VALUES.admins, "group:security"];
      const collapsed = applyAudienceSelection(narrower, [
        ...narrower,
        ALL_MEMBERS_VALUE,
      ]);
      expect(collapsed).toEqual([ALL_MEMBERS_VALUE]);

      const widened = applyAudienceSelection(collapsed, [
        ...collapsed,
        "group:security",
      ]);
      expect(widened).toEqual(["group:security"]);
    });

    it("keeps any combination of narrower groups", () => {
      const next = applyAudienceSelection(
        ["projectOwner"],
        ["projectOwner", ROLE_VALUES.admins, "group:auditors"],
      );
      expect(next).toEqual(["projectOwner", ROLE_VALUES.admins, "group:auditors"]);
    });
  });

  describe("when the audience round-trips through picker values", () => {
    it("maps every group kind both ways", () => {
      const state = audience({
        allMembers: false,
        projectOwner: true,
        admins: true,
        members: true,
        viewers: true,
        groupIds: ["g1", "g2"],
      });
      expect(selectionToAudience(audienceToSelection(state))).toEqual(state);
    });
  });
});
