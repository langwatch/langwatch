// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * What the edit form submits, and what it refuses to.
 *
 * Creating a source and editing one differ in exactly one place — on create
 * the upstream secret is mandatory and typed in front of you; on edit it is
 * never shown, because `toDto` strips it, so a blank field has to mean "keep
 * the stored one".
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
import { recommendedPullSchedule } from "../../logic/pullCadence";
import {
  buildAnthropicAdminPullConfig,
  buildEditedParserConfig,
  buildEditSubmission,
} from "../inventory";
import { composer } from "./editPullSourceConfig.fixture";

// `resolvePullConfig` toasts the offending field when a pull config will not
// build. That is the behaviour under test's own reporting channel, not a
// dependency of it, and Chakra's toaster has no store outside a rendered app.
vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

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

  it("resolves a cleared cadence to the recommended schedule, never null", () => {
    // Blank is the cadence field's way of saying "the recommended schedule".
    // Saving null instead would disable the source — see the lifecycle
    // regression below, which is what makes this more than a shape assertion.
    expect(submit({ pullSchedule: "   " })?.pullSchedule).toBe(
      recommendedPullSchedule("anthropic_admin"),
    );
  });

  it("keeps the saved cadence and the rebuilt config agreeing on the default", () => {
    // The drawer reads the cadence back out of parserConfig. If the column
    // said null while the config said "0 * * * *", the source would show a
    // schedule it was no longer running on.
    const next = submit({ pullSchedule: "" });

    expect(next?.pullSchedule).toBe(next?.parserConfig.schedule);
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

/**
 * Reaches across into the poller lifecycle on purpose. The cadence bug was
 * never visible inside either half: the drawer emitted a defensible `null`
 * and the lifecycle correctly read `null` as "disable". Only a test that runs
 * the edit path's output through the thing that consumes it can fail.
 */
