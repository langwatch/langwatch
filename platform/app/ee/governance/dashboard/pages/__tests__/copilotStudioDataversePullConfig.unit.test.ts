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
});
