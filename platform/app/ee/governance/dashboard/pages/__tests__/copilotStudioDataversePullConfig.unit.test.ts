// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The contract between the Dataverse composer form and the adapter.
 *
 * Nothing validates a pullConfig at save time — the first thing that reads it
 * is the puller worker — so a shape mismatch is a source that looked fine when
 * it was created and fails on every run. The optional Azure subscription is
 * the field most likely to produce that: it is a uuid the schema refuses when
 * empty, and it is the one field an admin is expected to leave blank.
 *
 * Spec: specs/ai-governance/puller-framework/copilot-studio-dataverse.feature
 */

import { describe, expect, it } from "vitest";

import { copilotStudioDataversePullConfigSchema } from "../../../services/pullers/copilotStudioDataverse.puller";
import {
  buildCopilotStudioDataversePullConfig,
  buildParserConfig,
  type ComposerState,
  PARSER_FIELDS,
} from "../inventory";

const SUBSCRIPTION_ID = "00000000-0000-0000-0000-000000000000";

function composer(parserConfig: Record<string, string>): ComposerState {
  return {
    sourceType: "copilot_studio_dataverse",
    name: "Copilot Studio",
    description: "",
    parserConfig,
    ottlStatements: [],
    pullSchedule: "",
    traceProjectId: null,
  };
}

const REQUIRED = {
  environmentUrl: "https://org12345.crm.dynamics.com",
  credentialsTenantId: "3807ec24-0000-4000-8000-000000000001",
  credentialsClientId: "app-client-id",
  credentialsClientSecret: "app-client-secret",
};

describe("buildCopilotStudioDataversePullConfig", () => {
  describe("when the admin leaves the Azure subscription blank", () => {
    /** @scenario "A source that names no subscription reads no cost at all" */
    it("omits the field rather than saving an empty string", () => {
      const config = buildCopilotStudioDataversePullConfig(
        composer({ ...REQUIRED, azureSubscriptionId: "" }),
      );

      // An empty string is not a uuid, so saving one would fail the adapter's
      // own schema on the first run — for a field the admin deliberately left
      // blank.
      expect(config).not.toHaveProperty("azureSubscriptionId");
      const parsed = copilotStudioDataversePullConfigSchema.parse(config);
      expect(parsed.azureSubscriptionId).toBeUndefined();
    });

    /** @scenario "A source that names no subscription reads no cost at all" */
    it("still produces a config the adapter accepts", () => {
      const config = buildCopilotStudioDataversePullConfig(composer(REQUIRED));

      expect(() =>
        copilotStudioDataversePullConfigSchema.parse(config),
      ).not.toThrow();
    });
  });

  describe("when the admin names an Azure subscription", () => {
    /** @scenario "The daily bill is read as the currency the customer is billed in" */
    it("carries it through to the adapter's config", () => {
      const config = buildCopilotStudioDataversePullConfig(
        composer({ ...REQUIRED, azureSubscriptionId: ` ${SUBSCRIPTION_ID} ` }),
      );

      const parsed = copilotStudioDataversePullConfigSchema.parse(config);
      expect(parsed.azureSubscriptionId).toBe(SUBSCRIPTION_ID);
    });

    /** @scenario "The daily bill is read as the currency the customer is billed in" */
    it("keeps it out of parserConfig, which wins the server-side merge", () => {
      const parserConfig = buildParserConfig(
        composer({ ...REQUIRED, azureSubscriptionId: SUBSCRIPTION_ID }),
      );

      // The server merges pullConfig into parserConfig and lets parserConfig
      // win a key clash, so a field the builder decides about must not also
      // have a raw copy here.
      expect(parserConfig).not.toHaveProperty("azureSubscriptionId");
    });

    /** @scenario "The daily bill is read as the currency the customer is billed in" */
    it("is not treated as a secret, so it reaches the config at all", () => {
      const config = buildCopilotStudioDataversePullConfig(
        composer({ ...REQUIRED, azureSubscriptionId: SUBSCRIPTION_ID }),
      ) as Record<string, unknown>;

      // A `credentials*` name would have buried it in the encrypted subtree,
      // where the config schema never looks.
      expect(config.credentials).not.toHaveProperty("azureSubscriptionId");
      expect(config.azureSubscriptionId).toBe(SUBSCRIPTION_ID);
    });
  });

  describe("when the admin has not asked for licence counts", () => {
    /** @scenario "A source that has not opted in reads no licences at all" */
    it("leaves the read off for a source that never mentions it", () => {
      const config = buildCopilotStudioDataversePullConfig(composer(REQUIRED));

      // Every source that exists today was created before the field did, so
      // the absent case is the one that decides whether this ships dark or
      // starts calling Graph on everyone's tenant.
      const parsed = copilotStudioDataversePullConfigSchema.parse(config);
      expect(parsed.readSeats).toBe(false);
    });

    /** @scenario "A source that has not opted in reads no licences at all" */
    it("reads the form's own default as off", () => {
      const config = buildCopilotStudioDataversePullConfig(
        composer({ ...REQUIRED, readSeats: "no" }),
      );

      const parsed = copilotStudioDataversePullConfigSchema.parse(config);
      expect(parsed.readSeats).toBe(false);
    });

    /** @scenario "A source that has not opted in reads no licences at all" */
    it("reads anything it does not recognise as off, not as on", () => {
      const config = buildCopilotStudioDataversePullConfig(
        composer({ ...REQUIRED, readSeats: "sure" }),
      );

      // The failure that matters is one-directional: a value misread as `true`
      // starts calling a tenant API nobody consented to, while one misread as
      // `false` only leaves a setting looking ignored.
      const parsed = copilotStudioDataversePullConfigSchema.parse(config);
      expect(parsed.readSeats).toBe(false);
    });
  });

  describe("when the admin asks for licence counts", () => {
    /** @scenario "Each licence pool is recorded with bought and assigned counts" */
    it("turns the form's string into the boolean the adapter's schema wants", () => {
      const config = buildCopilotStudioDataversePullConfig(
        composer({ ...REQUIRED, readSeats: "yes" }),
      ) as Record<string, unknown>;

      // Not just truthy: the schema is `z.boolean()`, so the string "yes"
      // reaching it unconverted fails the save rather than enabling anything.
      expect(config.readSeats).toBe(true);
      const parsed = copilotStudioDataversePullConfigSchema.parse(config);
      expect(parsed.readSeats).toBe(true);
    });

    /** @scenario "Each licence pool is recorded with bought and assigned counts" */
    it("also accepts the string a stored boolean would seed the form with", () => {
      // `seedComposerParserConfig` re-opens a saved config as form strings via
      // `String(stored)`, which turns a stored `true` into "true" rather than
      // "yes". This source type is not in EDITABLE_PULL_CONFIG_SOURCE_TYPES
      // yet, so nothing takes that path today; accepting it here is what stops
      // adding it later from silently turning the setting off on save.
      const config = buildCopilotStudioDataversePullConfig(
        composer({ ...REQUIRED, readSeats: "true" }),
      );

      const parsed = copilotStudioDataversePullConfigSchema.parse(config);
      expect(parsed.readSeats).toBe(true);
    });

    /** @scenario "Each licence pool is recorded with bought and assigned counts" */
    it("keeps it out of parserConfig, which wins the server-side merge", () => {
      const parserConfig = buildParserConfig(
        composer({ ...REQUIRED, readSeats: "yes" }),
      );

      // A raw "yes" left here would win the merge and reach the adapter as a
      // string where its schema demands a boolean.
      expect(parserConfig).not.toHaveProperty("readSeats");
    });
  });

  describe("the composer's own field list", () => {
    const field = PARSER_FIELDS.copilot_studio_dataverse.find(
      (f) => f.key === "readSeats",
    );

    /** @scenario "A source that has not opted in reads no licences at all" */
    it("offers the licence read as a closed choice", () => {
      // Without an entry here the setting is unreachable from the form and the
      // builder above is dead code — which is exactly the state this field was
      // added to end.
      expect(field).toBeDefined();
      expect(field?.control).toBe("select");
      expect(field?.secret).toBeFalsy();
    });

    /** @scenario "A source that has not opted in reads no licences at all" */
    it("shows the off choice first, so an untouched form reads as off", () => {
      const options = field?.options?.({}) ?? [];

      // A controlled <select> holding "" with no "" option displays its first
      // entry, so first-is-off is what keeps the control agreeing with the
      // builder on a form nobody has touched.
      expect(options[0]?.value).toBe("no");
      expect(options.map((o) => o.value)).toEqual(["no", "yes"]);
    });

    /** @scenario "A source that has not opted in reads no licences at all" */
    it("says out loud that it needs its own admin consent", () => {
      // The one thing an admin cannot discover by trying it: flipping this on
      // without the tenant-wide grant produces a 403 the puller swallows, so
      // the setting would look on and quietly report nothing.
      expect(field?.hint).toContain("Organization.Read.All");
    });
  });
});
