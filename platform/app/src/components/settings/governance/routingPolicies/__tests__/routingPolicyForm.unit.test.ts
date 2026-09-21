/**
 * @vitest-environment node
 *
 * The round trip between a stored policy and what the editor edits.
 *
 * The interesting cases are the ones where the two shapes disagree: tiers
 * live inside the same stored map as ordinary name mappings, and restriction
 * rules are arrays on the wire but newline-separated text in a textarea.
 */
import { describe, expect, it } from "vitest";

import {
  countAnsweredTiers,
  countRestrictions,
  emptyRoutingPolicyForm,
  modelAliasesFromForm,
  restrictionsToPayload,
  routingPolicyToFormValues,
  type StoredRoutingPolicy,
  unansweredTiers,
  validateRoutingPolicyForm,
} from "../routingPolicyForm";

function storedPolicy(
  overrides: Partial<StoredRoutingPolicy> = {},
): StoredRoutingPolicy {
  return {
    name: "developer default",
    description: null,
    modelProviderIds: ["mp_openai"],
    modelAliases: {},
    defaultModel: null,
    policyRules: {},
    isDefault: false,
    scopes: [{ scopeType: "ORGANIZATION", scopeId: "org_1" }],
    ...overrides,
  };
}

describe("given a stored policy whose mapping mixes tiers and ordinary names", () => {
  it("splits them, because they are edited in different places", () => {
    const values = routingPolicyToFormValues(
      storedPolicy({
        modelAliases: {
          complex: "anthropic/claude-opus-4-5",
          fast: "openai/gpt-5-mini",
          "gpt-4o": "openai/gpt-5",
        },
      }),
    );

    expect(values.tiers).toEqual({
      complex: "anthropic/claude-opus-4-5",
      reasoning: "",
      fast: "openai/gpt-5-mini",
    });
    expect(values.nameMappings).toEqual([
      { from: "gpt-4o", to: "openai/gpt-5" },
    ]);
  });

  it("puts them back together unchanged", () => {
    const stored = {
      complex: "anthropic/claude-opus-4-5",
      fast: "openai/gpt-5-mini",
      "gpt-4o": "openai/gpt-5",
    };

    const roundTripped = modelAliasesFromForm(
      routingPolicyToFormValues(storedPolicy({ modelAliases: stored })),
    );

    expect(roundTripped).toEqual(stored);
  });

  it("leaves a blank tier out, so it falls through to the default model", () => {
    const values = emptyRoutingPolicyForm();
    values.tiers.fast = "openai/gpt-5-mini";

    expect(modelAliasesFromForm(values)).toEqual({ fast: "openai/gpt-5-mini" });
  });

  it("drops a half-typed name mapping rather than storing an empty target", () => {
    const values = emptyRoutingPolicyForm();
    values.nameMappings = [
      { from: "gpt-4o", to: "" },
      { from: "", to: "openai/gpt-5" },
      { from: "  claude  ", to: "  anthropic/claude-opus-4-5  " },
    ];

    expect(modelAliasesFromForm(values)).toEqual({
      claude: "anthropic/claude-opus-4-5",
    });
  });
});

describe("given restriction rules", () => {
  it("reads them out of the stored arrays as editable text", () => {
    const values = routingPolicyToFormValues(
      storedPolicy({
        policyRules: {
          tools: { deny: ["^shell_.*", "delete_user"], allow: null },
          models: { deny: [], allow: ["^claude-.*"] },
        },
      }),
    );

    expect(values.restrictions.tools.deny).toBe("^shell_.*\ndelete_user");
    expect(values.restrictions.tools.allow).toBe("");
    expect(values.restrictions.models.allow).toBe("^claude-.*");
  });

  it("writes an empty allow list back as null, not an empty array", () => {
    // An empty array would read as "allow nothing", which refuses everything.
    const values = emptyRoutingPolicyForm();
    values.restrictions.tools.deny = "^shell_.*\n\n  delete_user  \n";

    const payload = restrictionsToPayload(values);

    expect(payload.tools).toEqual({
      deny: ["^shell_.*", "delete_user"],
      allow: null,
    });
    expect(payload.urls).toEqual({ deny: [], allow: null });
  });

  it("counts every rule across every dimension for the section header", () => {
    const values = emptyRoutingPolicyForm();
    values.restrictions.tools.deny = "a\nb";
    values.restrictions.models.allow = "c";

    expect(countRestrictions(values)).toBe(3);
    expect(countRestrictions(emptyRoutingPolicyForm())).toBe(0);
  });
});

describe("given a policy being validated before save", () => {
  it("refuses a name mapping that reuses a reserved tier name", () => {
    const values = emptyRoutingPolicyForm();
    values.nameMappings = [{ from: "fast", to: "openai/gpt-5-mini" }];

    const problems = validateRoutingPolicyForm({
      values,
      boundProviderTypes: new Set(["openai"]),
    });

    expect(problems.some((problem) => problem.includes("fast"))).toBe(true);
  });

  it("refuses the same name mapped twice", () => {
    const values = emptyRoutingPolicyForm();
    values.nameMappings = [
      { from: "gpt-4o", to: "openai/gpt-5" },
      { from: "gpt-4o", to: "openai/gpt-5-mini" },
    ];

    const problems = validateRoutingPolicyForm({
      values,
      boundProviderTypes: new Set(["openai"]),
    });

    expect(problems.some((problem) => problem.includes("more than once"))).toBe(
      true,
    );
  });

  it("refuses a target naming a provider this policy does not route through", () => {
    const values = emptyRoutingPolicyForm();
    values.tiers.complex = "anthropic/claude-opus-4-5";

    const problems = validateRoutingPolicyForm({
      values,
      boundProviderTypes: new Set(["openai"]),
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("anthropic");
  });

  it("accepts a target with no provider prefix, which resolves at dispatch", () => {
    const values = emptyRoutingPolicyForm();
    values.tiers.fast = "gpt-5-mini";

    expect(
      validateRoutingPolicyForm({
        values,
        boundProviderTypes: new Set(["openai"]),
      }),
    ).toEqual([]);
  });
});

describe("given a policy summarised for the list", () => {
  it("counts a default model as answering every tier", () => {
    const values = emptyRoutingPolicyForm();
    values.defaultModel = "openai/gpt-5-mini";

    expect(countAnsweredTiers(values)).toBe(3);
    expect(unansweredTiers(values)).toEqual([]);
  });

  it("counts only the tiers named when there is no default model", () => {
    const values = emptyRoutingPolicyForm();
    values.tiers.fast = "openai/gpt-5-mini";

    expect(countAnsweredTiers(values)).toBe(1);
    expect(unansweredTiers(values)).toEqual(["complex", "reasoning"]);
  });
});
