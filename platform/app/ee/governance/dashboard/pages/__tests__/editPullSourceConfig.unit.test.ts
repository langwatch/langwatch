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

import { describe, expect, it } from "vitest";

import { anthropicAdminPullConfigSchema } from "../../../services/pullers/anthropicAdmin.puller";
import {
  buildAnthropicAdminPullConfig,
  buildEditedParserConfig,
  type ComposerState,
  seedComposerParserConfig,
} from "../ingestion-sources";

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
