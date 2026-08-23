// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The edit path's half of the composer contract. Creating a source and
 * editing one differ in exactly one place — on create the upstream secret is
 * mandatory and typed in front of you; on edit it is never shown, because
 * `toDto` strips it, so a blank field has to mean "keep the stored one".
 *
 * That single difference is the whole risk. `updateSource` carries the stored
 * credential across only when the key is `undefined`; a builder that helpfully
 * emits `credentials: { token: "" }` instead would overwrite a working key
 * with an empty one and break the source on its next run — the same class of
 * silent-until-the-next-pull failure the sibling test guards on create.
 *
 * The mirror case is just as bad: the server refuses an encrypted envelope
 * arriving from a client, so anything that round-trips the stored parserConfig
 * back into the form must not carry `credentials` with it.
 */

import { describe, expect, it, vi } from "vitest";

import { anthropicAdminPullConfigSchema } from "../../../services/pullers/anthropicAdmin.puller";
import {
  buildAnthropicAdminPullConfig,
  buildEditedParserConfig,
  buildEditSubmission,
  type ComposerState,
  isEditablePullSource,
  parserFieldPresentation,
  seedComposerParserConfig,
} from "../ingestion-sources";

// `resolvePullConfig` toasts the offending field when a pull config will not
// build. That is the behaviour under test's own reporting channel, not a
// dependency of it, and Chakra's toaster has no store outside a rendered app.
vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

function composer(
  parserConfig: Record<string, string>,
  pullSchedule = "",
): ComposerState {
  return {
    sourceType: "anthropic_admin",
    name: "Anthropic org spend",
    description: "",
    parserConfig,
    ottlStatements: [],
    pullSchedule,
  };
}

describe("buildAnthropicAdminPullConfig on the edit path", () => {
  it("given a blank secret, omits the credentials key entirely so the stored one is kept", () => {
    const config = buildAnthropicAdminPullConfig(
      composer({ credentialsToken: "", report: "usage", bucketWidth: "1h" }),
      { requireCredentials: false },
    );

    expect(config).not.toBeNull();
    // Not `{ token: "" }`, and not `undefined` under a present key: absent.
    // `updateSource` only carries the stored envelope across for a key that
    // is genuinely missing from the incoming object.
    expect(config).not.toHaveProperty("credentials");
    expect(Object.keys(config!)).not.toContain("credentials");
  });

  it("given a blank secret, still validates and normalizes every other field", () => {
    const config = buildAnthropicAdminPullConfig(
      composer({
        credentialsToken: "",
        report: "usage",
        bucketWidth: "1h",
        startingAt: "2026-08-01",
      }),
      { requireCredentials: false },
    );

    const parsed = anthropicAdminPullConfigSchema.parse(config);
    expect(parsed.report).toBe("usage");
    expect(parsed.bucketWidth).toBe("1h");
    expect(parsed.startingAt).toBe("2026-08-01T00:00:00.000Z");
  });

  it("given a freshly typed secret, carries it so the stored one is replaced", () => {
    const config = buildAnthropicAdminPullConfig(
      composer({ credentialsToken: "sk-ant-admin-new", report: "usage" }),
      { requireCredentials: false },
    );

    expect((config as Record<string, unknown>).credentials).toEqual({
      token: "sk-ant-admin-new",
    });
  });

  it("given an invalid bucket width, refuses the save on the edit path too", () => {
    // A real token, deliberately: with a blank one this would return null
    // whether or not the bucket width was ever checked, and the test would
    // keep passing with the validation removed.
    const config = buildAnthropicAdminPullConfig(
      composer({
        credentialsToken: "sk-ant-admin-test",
        report: "usage",
        bucketWidth: "5m",
      }),
      { requireCredentials: false },
    );

    expect(config).toBeNull();
  });

  it("still requires the secret on the create path", () => {
    // The default must not drift: on create there is no stored credential to
    // fall back on, so a blank token is a broken source, not an unchanged one.
    expect(
      buildAnthropicAdminPullConfig(
        composer({ credentialsToken: "", report: "usage" }),
      ),
    ).toBeNull();
  });
});

describe("buildEditedParserConfig", () => {
  const stored = {
    adapter: "anthropic_admin",
    report: "usage",
    bucketWidth: "1h",
    startingAt: "2026-08-01T00:00:00.000Z",
    schedule: "0 * * * *",
    workspaceId: "ws_kept",
  };

  it("clears a field the admin emptied instead of leaving the old value", () => {
    // The regression this exists for: merging the rebuilt config over the
    // stored one with a plain spread leaves an omitted key untouched, so
    // clearing a bucket width saved successfully and changed nothing.
    const rebuilt = buildAnthropicAdminPullConfig(
      composer({ credentialsToken: "", report: "usage", bucketWidth: "" }),
      { requireCredentials: false },
    );

    const next = buildEditedParserConfig({
      sourceType: "anthropic_admin",
      storedParserConfig: stored,
      rebuiltPullConfig: rebuilt,
      ottlStatements: [],
    });

    expect(next).not.toHaveProperty("bucketWidth");
    expect(next).not.toHaveProperty("startingAt");
  });

  it("keeps adapter bookkeeping the form does not own", () => {
    const rebuilt = buildAnthropicAdminPullConfig(
      composer({ credentialsToken: "", report: "usage" }),
      { requireCredentials: false },
    );

    const next = buildEditedParserConfig({
      sourceType: "anthropic_admin",
      storedParserConfig: stored,
      rebuiltPullConfig: rebuilt,
      ottlStatements: [],
    });

    expect(next.workspaceId).toBe("ws_kept");
  });

  it("carries no credentials key when the secret was left blank", () => {
    const rebuilt = buildAnthropicAdminPullConfig(
      composer({ credentialsToken: "", report: "usage" }),
      { requireCredentials: false },
    );

    const next = buildEditedParserConfig({
      sourceType: "anthropic_admin",
      storedParserConfig: stored,
      rebuiltPullConfig: rebuilt,
      ottlStatements: [],
    });

    expect(next).not.toHaveProperty("credentials");
  });

  it("drops a stored envelope rather than replaying it to the server", () => {
    const next = buildEditedParserConfig({
      sourceType: "anthropic_admin",
      storedParserConfig: {
        ...stored,
        credentials: "enc:v1:deadbeef:cafe:0123",
      },
      rebuiltPullConfig: null,
      ottlStatements: [],
    });

    expect(next).not.toHaveProperty("credentials");
  });

  it("leaves a push-mode source's config alone apart from its OTTL", () => {
    // rebuiltPullConfig null is the push-mode path: nothing about the adapter
    // config is the form's to touch, so every stored key must survive.
    const next = buildEditedParserConfig({
      sourceType: "otel_generic",
      storedParserConfig: { sharedSecretLastFour: "9931" },
      rebuiltPullConfig: null,
      ottlStatements: ['set(attributes["a"], 1)', "  "],
    });

    expect(next.sharedSecretLastFour).toBe("9931");
    expect(next.ottlStatements).toEqual(['set(attributes["a"], 1)']);
  });

  it("removes the OTTL list entirely when the last statement is cleared", () => {
    const next = buildEditedParserConfig({
      sourceType: "otel_generic",
      storedParserConfig: { ottlStatements: ["set(x, 1)"] },
      rebuiltPullConfig: null,
      ottlStatements: ["   "],
    });

    expect(next).not.toHaveProperty("ottlStatements");
  });
});

describe("isEditablePullSource", () => {
  it("accepts a pull type the form knows how to rebuild", () => {
    expect(isEditablePullSource("anthropic_admin")).toBe(true);
  });

  it("refuses a pull type whose blank-secret meaning is ambiguous", () => {
    // Genie takes either a workspace token or a service-principal pair, so a
    // blank form there could mean "keep what is stored" or "switch auth
    // modes". Guessing locks an admin out of their own source.
    expect(isEditablePullSource("databricks_genie")).toBe(false);
  });

  it("refuses a push type, which has no pull config to rebuild", () => {
    expect(isEditablePullSource("otel_generic")).toBe(false);
  });

  it("refuses an absent type rather than throwing", () => {
    // A row written by a newer deploy reaches this page as a string that misses
    // every table; it must read as "not editable", not crash the drawer.
    expect(isEditablePullSource(undefined)).toBe(false);
  });
});

describe("buildEditSubmission", () => {
  const pullSource = {
    id: "src_1",
    sourceType: "anthropic_admin",
    parserConfig: {
      adapter: "anthropic_admin",
      report: "usage",
      bucketWidth: "1h",
      schedule: "0 * * * *",
      workspaceId: "ws_kept",
    },
  };

  function submit(
    overrides: Partial<Parameters<typeof buildEditSubmission>[0]>,
  ) {
    return buildEditSubmission({
      organizationId: "org_1",
      source: pullSource,
      name: "Anthropic org spend",
      description: "",
      parserConfig: {
        credentialsToken: "",
        report: "usage",
        bucketWidth: "1h",
      },
      ottlStatements: [],
      pullSchedule: "0 * * * *",
      ...overrides,
    });
  }

  it("given a blank name, refuses the save", () => {
    expect(submit({ name: "   " })).toBeNull();
  });

  it("given a pull field the adapter cannot parse, refuses the save", () => {
    // Nothing validates pullConfig server-side, so a bad bucket width saved
    // here would sit in the row looking fine and fail on every pull.
    expect(
      submit({
        parserConfig: {
          credentialsToken: "",
          report: "usage",
          bucketWidth: "5m",
        },
      }),
    ).toBeNull();
  });

  it("sends the cadence for a pull source", () => {
    expect(submit({ pullSchedule: " 0 */2 * * * " })?.pullSchedule).toBe(
      "0 */2 * * *",
    );
  });

  it("sends a cleared cadence as null rather than an empty string", () => {
    expect(submit({ pullSchedule: "   " })?.pullSchedule).toBeNull();
  });

  it("omits the cadence key entirely for a push source", () => {
    // Not `null`: a push source has no cadence column anyone edited, and
    // sending one would write over a field this form does not own.
    const next = submit({
      source: {
        id: "src_2",
        sourceType: "otel_generic",
        parserConfig: { sharedSecretLastFour: "9931" },
      },
    });

    expect(next).not.toBeNull();
    expect(next).not.toHaveProperty("pullSchedule");
  });

  it("leaves a push source's adapter config untouched", () => {
    const next = submit({
      source: {
        id: "src_2",
        sourceType: "otel_generic",
        parserConfig: { sharedSecretLastFour: "9931" },
      },
    });

    expect(next?.parserConfig.sharedSecretLastFour).toBe("9931");
  });

  it("trims the name and nulls an emptied description", () => {
    const next = submit({ name: "  Renamed  ", description: "   " });

    expect(next?.name).toBe("Renamed");
    expect(next?.description).toBeNull();
  });

  it("carries no credentials key when the secret was left blank", () => {
    // The whole risk of the edit path: `updateSource` keeps the stored
    // envelope only for a key that is genuinely absent.
    expect(submit({})?.parserConfig).not.toHaveProperty("credentials");
  });

  it("carries a freshly typed secret so the stored one is replaced", () => {
    const next = submit({
      parserConfig: {
        credentialsToken: "sk-ant-admin-new",
        report: "usage",
        bucketWidth: "1h",
      },
    });

    expect(next?.parserConfig.credentials).toEqual({
      token: "sk-ant-admin-new",
    });
  });
});

describe("parserFieldPresentation", () => {
  const secretField = {
    key: "credentialsToken",
    label: "Admin API key",
    placeholder: "sk-ant-admin-...",
    hint: "Generate one in the Anthropic console.",
    required: true,
  };
  const plainField = {
    key: "report",
    label: "Report",
    placeholder: "usage",
    hint: "usage or cost",
    required: true,
  };

  it("on edit, tells the admin a blank secret keeps the current key", () => {
    const p = parserFieldPresentation({ field: secretField, mode: "edit" });

    expect(p.hint).toContain("Leave blank to keep the current key");
    expect(p.placeholder).toBe("Unchanged");
  });

  it("on edit, drops the required marker from a secret", () => {
    // A field that says "leave blank to keep the current key" while still
    // carrying a required marker is a form contradicting itself.
    expect(
      parserFieldPresentation({ field: secretField, mode: "edit" }).isRequired,
    ).toBe(false);
  });

  it("on create, keeps the secret mandatory and its own hint", () => {
    const p = parserFieldPresentation({ field: secretField, mode: "create" });

    expect(p.isRequired).toBe(true);
    expect(p.hint).toBe(secretField.hint);
    expect(p.placeholder).toBe(secretField.placeholder);
  });

  it("leaves a non-secret field identical in both modes", () => {
    expect(
      parserFieldPresentation({ field: plainField, mode: "edit" }),
    ).toEqual(parserFieldPresentation({ field: plainField, mode: "create" }));
  });

  it("marks the DSL fields as multiline", () => {
    for (const key of ["parserDsl", "eventMappingDsl"]) {
      expect(
        parserFieldPresentation({
          field: { ...plainField, key },
          mode: "create",
        }).isMultiline,
      ).toBe(true);
    }
    expect(
      parserFieldPresentation({ field: plainField, mode: "create" })
        .isMultiline,
    ).toBe(false);
  });
});

describe("seedComposerParserConfig", () => {
  it("maps a stored config back onto the form fields", () => {
    const values = seedComposerParserConfig({
      sourceType: "anthropic_admin",
      storedParserConfig: {
        adapter: "anthropic_admin",
        report: "usage",
        bucketWidth: "1h",
        startingAt: "2026-08-01T00:00:00.000Z",
      },
    });

    expect(values.report).toBe("usage");
    expect(values.bucketWidth).toBe("1h");
    expect(values.startingAt).toBe("2026-08-01T00:00:00.000Z");
  });

  it("leaves every secret field blank rather than pre-filling it", () => {
    const values = seedComposerParserConfig({
      sourceType: "anthropic_admin",
      storedParserConfig: { report: "usage" },
    });

    expect(values.credentialsToken ?? "").toBe("");
  });

  it("never surfaces a stored credential into the form, even if one reaches it", () => {
    // `toDto` strips `credentials` today, so this should be unreachable. It is
    // asserted anyway because the cost of that stripping regressing is the
    // form posting an envelope straight back into the server's replay refusal.
    const values = seedComposerParserConfig({
      sourceType: "anthropic_admin",
      storedParserConfig: {
        report: "usage",
        credentials: "enc:v1:deadbeef:cafe:0123",
      },
    });

    expect(Object.values(values).join(" ")).not.toContain("enc:v1:");
    expect(values.credentialsToken ?? "").toBe("");
  });

  it("round-trips an untouched form without proposing any credential change", () => {
    const stored = {
      adapter: "anthropic_admin",
      report: "usage",
      bucketWidth: "1h",
      schedule: "0 * * * *",
    };
    const values = seedComposerParserConfig({
      sourceType: "anthropic_admin",
      storedParserConfig: stored,
    });

    const config = buildAnthropicAdminPullConfig(
      composer(values, "0 * * * *"),
      { requireCredentials: false },
    );

    expect(config).not.toHaveProperty("credentials");
    expect(anthropicAdminPullConfigSchema.parse(config).report).toBe("usage");
  });
});
