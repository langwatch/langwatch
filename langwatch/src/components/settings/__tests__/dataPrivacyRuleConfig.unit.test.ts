import { describe, expect, it } from "vitest";

import {
  EMPTY_AUDIENCE,
  PLATFORM_DEFAULT_DATA_PRIVACY,
  type ResolvedDataPrivacy,
} from "~/server/data-privacy/dataPrivacy.types";
import {
  ALL_MEMBERS_VALUE,
  type AudienceFormState,
  applyAudienceSelection,
  audienceConfig,
  audienceToSelection,
  buildRuleConfig,
  type CategoryChoice,
  type CustomAttributeFormRow,
  configsEqual,
  configToFormState,
  EMPTY_AUDIENCE_FORM,
  inheritedBaselineForScope,
  inheritFormState,
  isEmptyRuleConfig,
  type PiiChoice,
  ROLE_VALUES,
  type RuleFormState,
  ruleSummary,
  type SecretsChoice,
  selectionToAudience,
} from "../dataPrivacyRuleConfig";

const inheritDispositions: RuleFormState["dispositions"] = {
  input: "inherit",
  output: "inherit",
  system: "inherit",
  tools: "inherit",
};

function audience(partial: Partial<AudienceFormState> = {}): AudienceFormState {
  return { ...EMPTY_AUDIENCE_FORM, ...partial };
}

function build({
  dispositions = inheritDispositions,
  aud = audience({ admins: true }),
  piiChoice = "inherit" as PiiChoice,
  piiEntities = [] as string[],
  secretsChoice = "inherit" as SecretsChoice,
  secretsPatterns = [] as string[],
  customAttributes = [] as CustomAttributeFormRow[],
}: {
  dispositions?: RuleFormState["dispositions"];
  aud?: AudienceFormState;
  piiChoice?: PiiChoice;
  piiEntities?: string[];
  secretsChoice?: SecretsChoice;
  secretsPatterns?: string[];
  customAttributes?: CustomAttributeFormRow[];
}) {
  return buildRuleConfig({
    dispositions,
    audience: aud,
    piiChoice,
    piiEntities,
    secretsChoice,
    secretsPatterns,
    customAttributes,
  });
}

function withCategory(
  category: keyof RuleFormState["dispositions"],
  choice: CategoryChoice,
): RuleFormState["dispositions"] {
  return { ...inheritDispositions, [category]: choice };
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
    pii: { level: "essential", entities: [] },
    secrets: { enabled: true, customPatterns: [] },
    customAttributes: [],
    ...overrides,
  };
}

describe("buildRuleConfig", () => {
  describe("given every control left on inherit", () => {
    /** @scenario Saving a rule with everything inheriting stores a rule that sets no fields */
    it("produces an empty config that changes nothing", () => {
      const config = build({});

      expect(isEmptyRuleConfig(config)).toBe(true);
    });
  });

  describe("given one category set and the rest inheriting", () => {
    /** @scenario Setting one category leaves the rest inheriting */
    it("includes only the set category and omits the inherited ones", () => {
      const config = build({ dispositions: withCategory("input", "drop") });

      expect(config.categories?.input).toEqual({ disposition: "drop" });
      expect(config.categories?.output).toBeUndefined();
      expect(config.categories?.system).toBeUndefined();
      expect(config.categories?.tools).toBeUndefined();
    });
  });

  describe("given a category explicitly set to capture over a stricter parent", () => {
    it("persists the capture disposition instead of inheriting", () => {
      const config = build({ dispositions: withCategory("input", "capture") });

      expect(config.categories?.input).toEqual({ disposition: "capture" });
    });
  });

  describe("given a restricted category", () => {
    it("attaches the full structured audience", () => {
      const config = build({
        dispositions: withCategory("output", "restrict"),
        aud: audience({ viewers: true, projectOwner: true, groupIds: ["g1"] }),
      });

      expect(config.categories?.output).toEqual({
        disposition: "restrict",
        audience: { viewers: true, projectOwner: true, groupIds: ["g1"] },
      });
    });
  });

  describe("given a PII choice", () => {
    it("omits PII when inheriting and writes the level when set", () => {
      expect(build({ piiChoice: "inherit" }).pii).toBeUndefined();
      expect(build({ piiChoice: "essential" }).pii).toEqual({
        level: "essential",
      });
      expect(build({ piiChoice: "disabled" }).pii).toEqual({
        level: "disabled",
      });
      expect(
        build({ piiChoice: "custom", piiEntities: ["BR_CPF", "EMAIL_ADDRESS"] })
          .pii,
      ).toEqual({ level: "custom", entities: ["BR_CPF", "EMAIL_ADDRESS"] });
    });
  });

  describe("given a secrets choice", () => {
    it("omits secrets when inheriting and writes the flag when on or off", () => {
      expect(build({ secretsChoice: "inherit" }).secrets).toBeUndefined();
      expect(build({ secretsChoice: "on" }).secrets).toEqual({ enabled: true });
      expect(build({ secretsChoice: "off" }).secrets).toEqual({
        enabled: false,
      });
    });

    it("persists trimmed custom patterns alongside the enabled flag", () => {
      const config = build({
        secretsChoice: "on",
        secretsPatterns: [" acme_live_[a-z0-9]+ ", ""],
      });

      expect(config.secrets).toEqual({
        enabled: true,
        customPatterns: ["acme_live_[a-z0-9]+"],
      });
    });

    it("discards leftover patterns when redaction is turned off", () => {
      const config = build({
        secretsChoice: "off",
        secretsPatterns: ["acme_live_[a-z0-9]+"],
      });

      expect(config.secrets).toEqual({ enabled: false });
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

describe("configToFormState", () => {
  describe("given a config that only sets one category", () => {
    it("shows the set category and leaves the rest on inherit", () => {
      const state = configToFormState({
        categories: { input: { disposition: "drop" } },
      });

      expect(state.dispositions.input).toBe("drop");
      expect(state.dispositions.output).toBe("inherit");
      expect(state.dispositions.system).toBe("inherit");
      expect(state.dispositions.tools).toBe("inherit");
      expect(state.piiChoice).toBe("inherit");
      expect(state.secretsChoice).toBe("inherit");
    });
  });

  describe("given a config that disables secrets", () => {
    it("reads secrets as explicitly off, not inherit", () => {
      expect(
        configToFormState({ secrets: { enabled: false } }).secretsChoice,
      ).toBe("off");
      expect(
        configToFormState({ secrets: { enabled: true } }).secretsChoice,
      ).toBe("on");
    });
  });

  describe("given a config with every kind of field", () => {
    const config = build({
      dispositions: withCategory("input", "restrict"),
      aud: audience({ projectOwner: true, groupIds: ["g1"] }),
      piiChoice: "strict",
      secretsChoice: "on",
      secretsPatterns: ["acme_[0-9]+"],
      customAttributes: [{ pattern: "app.token", disposition: "drop" }],
    });

    it("hydrates the form state back, including the structured audience", () => {
      const state = configToFormState(config);

      expect(state.dispositions.input).toBe("restrict");
      expect(state.audience.projectOwner).toBe(true);
      expect(state.audience.groupIds).toEqual(["g1"]);
      expect(state.piiChoice).toBe("strict");
      expect(state.secretsChoice).toBe("on");
      expect(state.secretsPatterns).toEqual(["acme_[0-9]+"]);
      expect(state.customAttributes).toEqual([
        { pattern: "app.token", disposition: "drop" },
      ]);
    });

    it("round-trips back to an equal config", () => {
      const state = configToFormState(config);
      const rebuilt = buildRuleConfig(state);

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

  describe("when a previously-set field is reverted to inherit", () => {
    /** @scenario Reverting a field to Inherit removes it from the rule */
    it("drops that field from the rebuilt config", () => {
      const original = build({
        dispositions: {
          ...inheritDispositions,
          input: "drop",
          output: "capture",
        },
      });
      const state = configToFormState(original);

      const reverted = buildRuleConfig({
        ...state,
        dispositions: { ...state.dispositions, input: "inherit" },
      });

      expect(reverted.categories?.input).toBeUndefined();
      expect(reverted.categories?.output).toEqual({ disposition: "capture" });
    });
  });
});

describe("inheritFormState", () => {
  it("starts every control on inherit", () => {
    const state = inheritFormState();

    expect(state.dispositions).toEqual({
      input: "inherit",
      output: "inherit",
      system: "inherit",
      tools: "inherit",
    });
    expect(state.piiChoice).toBe("inherit");
    expect(state.secretsChoice).toBe("inherit");
    expect(state.customAttributes).toEqual([]);
    expect(isEmptyRuleConfig(buildRuleConfig(state))).toBe(true);
  });
});

describe("inheritedBaselineForScope", () => {
  const team = resolved({ pii: { level: "strict", entities: [] } });
  const org = resolved({ secrets: { enabled: false, customPatterns: [] } });

  it("resolves a project to its team baseline", () => {
    expect(
      inheritedBaselineForScope({
        scopeType: "PROJECT",
        effectiveTeam: team,
        effectiveOrganization: org,
      }),
    ).toBe(team);
  });

  it("resolves a team or department to the organization baseline", () => {
    expect(
      inheritedBaselineForScope({
        scopeType: "TEAM",
        effectiveTeam: team,
        effectiveOrganization: org,
      }),
    ).toBe(org);
    expect(
      inheritedBaselineForScope({
        scopeType: "DEPARTMENT",
        effectiveTeam: team,
        effectiveOrganization: org,
      }),
    ).toBe(org);
  });

  it("resolves an organization to the platform default", () => {
    expect(
      inheritedBaselineForScope({
        scopeType: "ORGANIZATION",
        effectiveTeam: team,
        effectiveOrganization: org,
      }),
    ).toBe(PLATFORM_DEFAULT_DATA_PRIVACY);
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
      "Input drop · 2 attribute rules · PII redaction off · Secrets redaction · 2 secret patterns",
    );
  });

  it("reads as inherits everything for an empty config", () => {
    expect(ruleSummary({})).toBe("Inherits everything");
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
