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
  fieldControl,
  PARSER_FIELDS,
  reconcileParserValues,
  seedComposerParserConfig,
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
  credentialsTenantId: "aaaaaaaa-0000-4000-8000-000000000001",
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

  describe("when the admin leaves the licence switch alone", () => {
    /** @scenario "Licence reading is on unless an admin switches it off" */
    it("reads licences, because an untouched form means the default", () => {
      const config = buildCopilotStudioDataversePullConfig(composer(REQUIRED));

      // The switch renders on for a form nobody has touched, so an absent
      // value has to mean the same thing here. Any other answer and the form
      // and the config it produces disagree about what the admin was shown.
      const parsed = copilotStudioDataversePullConfigSchema.parse(config);
      expect(parsed.readSeats).toBe(true);
    });

    /** @scenario "Licence reading is on unless an admin switches it off" */
    it("reads a value it does not recognise as the default, not as off", () => {
      const config = buildCopilotStudioDataversePullConfig(
        composer({ ...REQUIRED, readSeats: "sure" }),
      );

      // Only the switch writes this field, and it writes "true" or "false" and
      // nothing else. Anything else is a value no control produced, so it says
      // nothing about what the admin chose and the declared default stands.
      const parsed = copilotStudioDataversePullConfigSchema.parse(config);
      expect(parsed.readSeats).toBe(true);
    });

    /** @scenario "Each licence pool is recorded with bought and assigned counts" */
    it("turns the switch's string into the boolean the adapter's schema wants", () => {
      const config = buildCopilotStudioDataversePullConfig(
        composer({ ...REQUIRED, readSeats: "true" }),
      ) as Record<string, unknown>;

      // Not just truthy: the schema is `z.boolean()`, so the string "true"
      // reaching it unconverted fails the save rather than enabling anything.
      expect(config.readSeats).toBe(true);
    });

    /** @scenario "Each licence pool is recorded with bought and assigned counts" */
    it("keeps it out of parserConfig, which wins the server-side merge", () => {
      const parserConfig = buildParserConfig(
        composer({ ...REQUIRED, readSeats: "true" }),
      );

      // A raw "true" left here would win the merge and reach the adapter as a
      // string where its schema demands a boolean.
      expect(parserConfig).not.toHaveProperty("readSeats");
    });
  });

  describe("when the admin switches licence counts off", () => {
    /** @scenario "A source whose licence reading is switched off reads none at all" */
    it("carries the refusal through as a real false", () => {
      const config = buildCopilotStudioDataversePullConfig(
        composer({ ...REQUIRED, readSeats: "false" }),
      );

      const parsed = copilotStudioDataversePullConfigSchema.parse(config);
      expect(parsed.readSeats).toBe(false);
    });

    /** @scenario "A source whose licence reading is switched off reads none at all" */
    it("survives being reopened on the edit form", () => {
      // `seedComposerParserConfig` reopens a stored config as form strings with
      // `String(stored)`, so a stored `false` arrives as exactly the "false"
      // the switch writes. An off setting that came back on because the admin
      // edited an unrelated field is the failure this pins.
      const seeded = seedComposerParserConfig({
        sourceType: "copilot_studio_dataverse",
        storedParserConfig: { readSeats: false },
      });
      expect(seeded.readSeats).toBe("false");

      const config = buildCopilotStudioDataversePullConfig(
        composer({ ...REQUIRED, readSeats: seeded.readSeats ?? "" }),
      );

      const parsed = copilotStudioDataversePullConfigSchema.parse(config);
      expect(parsed.readSeats).toBe(false);
    });
  });

  describe("the composer's own field list", () => {
    const field = PARSER_FIELDS.copilot_studio_dataverse.find(
      (f) => f.key === "readSeats",
    );

    /** @scenario "Licence reading is on unless an admin switches it off" */
    it("offers the licence read as a switch that starts on", () => {
      // Without an entry here the setting is unreachable from the form and the
      // builder above is dead code — which is exactly the state this field was
      // added to end.
      expect(field).toBeDefined();
      expect(field?.control).toBe("switch");
      expect(field?.defaultOn).toBe(true);
      expect(field?.secret).toBeFalsy();
    });

    /** @scenario "Licence reading is on unless an admin switches it off" */
    it("keeps it in Advanced, because the default is already the answer", () => {
      // A setting that is right for almost everyone earns no room on the
      // leading path; the collapsed group is where an admin goes to disagree.
      expect(field?.advanced).toBe(true);
    });

    /** @scenario "A source whose licence reading is switched off reads none at all" */
    it("says out loud that it needs its own admin consent", () => {
      // The one thing an admin cannot discover by trying it: leaving this on
      // without the tenant-wide grant produces a 403 the puller swallows, so
      // the setting looks on and quietly reports nothing.
      expect(field?.hint).toContain("Organization.Read.All");
    });
  });

  describe("the control the form resolves for it", () => {
    const field = PARSER_FIELDS.copilot_studio_dataverse.find(
      (f) => f.key === "readSeats",
    );

    /** @scenario "Licence reading is on unless an admin switches it off" */
    it("carries the field's own default, so the render can agree with the builder", () => {
      expect(fieldControl({ field: field!, values: {} })).toMatchObject({
        kind: "switch",
        defaultOn: true,
      });
    });

    /** @scenario "A source whose licence reading is switched off reads none at all" */
    it("is left alone by the staleness sweep, which only knows option lists", () => {
      // `reconcileParserValues` clears a held value no control offers any more.
      // A switch has no option list, so "not in the list" means nothing here —
      // and clearing it would silently turn a deliberate off back on.
      const values = { ...REQUIRED, readSeats: "false" };

      expect(
        reconcileParserValues({
          sourceType: "copilot_studio_dataverse",
          values,
        }),
      ).toBe(values);
    });
  });
});
