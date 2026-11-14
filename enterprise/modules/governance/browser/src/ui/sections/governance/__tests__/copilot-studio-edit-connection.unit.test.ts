// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Correcting a Copilot Studio source's connection from the edit drawer (#9275), and the address
 * normalisation that keeps a bare host name from being stored (#9273).
 * Spec: specs/governance/edit-pull-source-config.feature
 */

import { copilotStudioDataversePullConfigSchema } from "@langwatch/enterprise-governance-contract";
import { describe, expect, it } from "vitest";

import { recordingGovernanceToaster } from "../../../../testing.tsx";
import {
  buildCopilotStudioDataversePullConfig,
  buildEditSubmission,
  type ComposerState,
  editSourceNotes,
  isEditablePullSource,
  lockedParserKeys,
  normalizeEnvironmentUrl,
  seedComposerParserConfig,
} from "../governance-inventory.screen.tsx";

const ENVIRONMENT = "https://org12345.crm.dynamics.com";
const AGENT = "aaaaaaaa-0000-4000-8000-000000000001";

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

const STORED = {
  adapter: "copilot_studio_dataverse",
  environmentUrl: ENVIRONMENT,
  botIds: [AGENT],
  readSeats: false,
  readDirectory: true,
  schedule: "*/15 * * * *",
};

function submit(parserConfig: Record<string, string>) {
  const toaster = recordingGovernanceToaster();
  const submission = buildEditSubmission({
    organizationId: "org_1",
    source: { id: "src_1", sourceType: "copilot_studio_dataverse", parserConfig: STORED },
    name: "Copilot Studio",
    description: "",
    parserConfig,
    ottlStatements: [],
    pullSchedule: "*/15 * * * *",
    destination: undefined,
    toaster,
  });
  return { submission, toaster };
}

describe("given an environment address typed without its scheme", () => {
  /** @scenario "An environment address typed without its scheme is completed by the form" */
  it("stores it with https in front", () => {
    const config = buildCopilotStudioDataversePullConfig(
      composer({
        environmentUrl: " org12345.crm.dynamics.com/ ",
        credentialsTenantId: "t",
        credentialsClientId: "c",
        credentialsClientSecret: "s",
      }),
    );

    expect(config?.environmentUrl).toBe(ENVIRONMENT);
    expect(() => copilotStudioDataversePullConfigSchema.parse(config)).not.toThrow();
  });

  it("leaves an address that names its scheme as typed, for the server to judge", () => {
    expect(normalizeEnvironmentUrl("http://org12345.crm.dynamics.com")).toBe(
      "http://org12345.crm.dynamics.com",
    );
    expect(normalizeEnvironmentUrl("   ")).toBe("");
  });
});

describe("given a Copilot Studio source opened for editing", () => {
  /** @scenario "The edit form opens on the stored connection" */
  it("offers its connection fields", () => {
    expect(isEditablePullSource("copilot_studio_dataverse")).toBe(true);
  });

  /** @scenario "The edit form opens on the stored connection" */
  it("seeds the stored connection and leaves every secret blank", () => {
    const seeded = seedComposerParserConfig({
      sourceType: "copilot_studio_dataverse",
      storedParserConfig: STORED,
    });

    expect(seeded.environmentUrl).toBe(ENVIRONMENT);
    expect(seeded.botIds).toBe(AGENT);
    expect(seeded.readSeats).toBe("false");
    expect(seeded.readDirectory).toBe("true");
    expect(seeded.credentialsTenantId).toBe("");
    expect(seeded.credentialsClientId).toBe("");
    expect(seeded.credentialsClientSecret).toBe("");
  });

  /** @scenario "Leaving the app registration blank keeps it" */
  it("submits a corrected address without any credentials key", () => {
    const seeded = seedComposerParserConfig({
      sourceType: "copilot_studio_dataverse",
      storedParserConfig: { ...STORED, environmentUrl: "org12345.crm.dynamics.com" },
    });

    const { submission } = submit(seeded);

    expect(submission?.parserConfig.environmentUrl).toBe(ENVIRONMENT);
    expect(submission?.parserConfig.botIds).toEqual([AGENT]);
    expect(submission?.parserConfig).not.toHaveProperty("credentials");
  });

  /** @scenario "Replacing the app registration takes all three values" */
  it("refuses part of a new app registration and says all three are needed", () => {
    const { submission, toaster } = submit({
      environmentUrl: ENVIRONMENT,
      credentialsTenantId: "",
      credentialsClientId: "new-client",
      credentialsClientSecret: "new-secret",
    });

    expect(submission).toBeNull();
    expect(toaster.toasts).toEqual([
      expect.objectContaining({
        type: "error",
        description: expect.stringMatching(/missing its tenant ID\..*all three/),
      }),
    ]);
    // The address is filled in, so the refusal must not send the admin looking for it.
    expect(toaster.toasts[0]?.description).not.toMatch(/environment URL/);
  });

  it("names every registration field still missing", () => {
    const { toaster } = submit({
      environmentUrl: ENVIRONMENT,
      credentialsTenantId: "",
      credentialsClientId: "new-client",
      credentialsClientSecret: "",
    });

    expect(toaster.toasts[0]?.description).toMatch(/missing its tenant ID and client secret\./);
  });

  it("asks only for the environment URL when that is what is missing", () => {
    const { submission, toaster } = submit({ environmentUrl: "" });

    expect(submission).toBeNull();
    expect(toaster.toasts[0]?.description).toBe("The environment URL is required.");
  });

  /** @scenario "A billing app registration typed without the main one is refused" */
  it("refuses a billing pair typed while the app registration is left blank, naming the billing fields", () => {
    const { submission, toaster } = submit({
      environmentUrl: ENVIRONMENT,
      azureSubscriptionId: "bbbbbbbb-0000-4000-8000-000000000002",
      azureBillingUsesSameApp: "false",
      credentialsTenantId: "",
      credentialsClientId: "",
      credentialsClientSecret: "",
      credentialsBillingClientId: "billing-client",
      credentialsBillingClientSecret: "billing-secret",
    });

    expect(submission).toBeNull();
    expect(toaster.toasts).toEqual([
      expect.objectContaining({
        type: "error",
        description: expect.stringMatching(/billing app registration client ID and secret/),
      }),
    ]);
  });

  it("replaces the app registration when all three are entered", () => {
    const { submission } = submit({
      environmentUrl: ENVIRONMENT,
      credentialsTenantId: "t2",
      credentialsClientId: "c2",
      credentialsClientSecret: "s2",
    });

    expect(submission?.parserConfig.credentials).toEqual({
      tenantId: "t2",
      clientId: "c2",
      clientSecret: "s2",
    });
  });
});

describe("given a Copilot Studio source that has pulled", () => {
  /** @scenario "The environment is fixed once the source has pulled" */
  it("shows the environment read-only and says why", () => {
    const locked = {
      hasPulled: true,
      report: undefined,
      sourceType: "copilot_studio_dataverse" as const,
    };

    expect(lockedParserKeys(locked)).toContain("environmentUrl");
    expect(editSourceNotes(locked).join(" ")).toMatch(/environment is fixed/);
  });

  it("leaves the environment editable before the first pull", () => {
    expect(
      lockedParserKeys({
        hasPulled: false,
        report: undefined,
        sourceType: "copilot_studio_dataverse",
      }),
    ).not.toContain("environmentUrl");
  });
});
