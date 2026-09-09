/**
 * @vitest-environment node
 *
 * The sign-up ceremony: which steps the declared intent selects, which of them
 * may fail without costing the customer the organization they just created,
 * what the first project is named when nobody named it, and what the client is
 * handed back.
 *
 * The ceremony used to live in the `onboarding.*` transport, where nothing
 * could reach it without a router. It is the onboarding service's now, and this
 * drives it directly over the two infrastructure interfaces it runs through.
 *
 * @see specs/features/onboarding/intent-fork.feature
 */
import type {
  OnboardingInitializeOrganizationInput,
  OrganizationCaller,
} from "@langwatch/organization-contract";
import { describe, expect, it, vi } from "vitest";

import type {
  OrganizationCeremony,
  OrganizationSignals,
} from "../../app/organization.infrastructure.ts";
import { OrganizationOnboardingService } from "../organization-onboarding.service.ts";

const ORGANIZATION = { id: "org_1", name: "Acme Corp" };
const TEAM = { id: "team_1", slug: "acme-team", name: "Acme Team" };
const CALLER: OrganizationCaller = {
  id: "user_1",
  name: "Jane Doe",
  email: "jane@example.com",
};

/** The ceremony's input, with the two defaults the parser applies. */
function request(
  input: Partial<OnboardingInitializeOrganizationInput> = {},
): OnboardingInitializeOrganizationInput {
  return { language: "other", framework: "other", ...input };
}

function harness(
  overrides: Partial<OrganizationCeremony & OrganizationSignals> = {},
  createAndAssign = vi.fn(async () => ({ organization: ORGANIZATION, team: TEAM })),
) {
  const ceremony = {
    ensureDefaultAiToolCatalog: vi.fn(async () => undefined),
    createProject: vi.fn(async () => ({ success: true, projectSlug: "acme-project" })),
    ...overrides,
  } as unknown as OrganizationCeremony;

  const signals = {
    trackServerEvent: vi.fn(),
    fireTeamMemberInvitedNurturing: vi.fn(),
    fireInviteAcceptedNurturing: vi.fn(),
    fireSignupNurturing: vi.fn(),
    sendSlackSignupEvent: vi.fn(async () => undefined),
    sendHubspotSignupForm: vi.fn(async () => undefined),
    recordIntegrationMethod: vi.fn(),
    reportError: vi.fn(),
    ...overrides,
  } as unknown as OrganizationSignals;

  const ensurePersonalWorkspace = vi.fn(async () => undefined);

  return {
    ceremony,
    signals,
    createAndAssign,
    ensurePersonalWorkspace,
    onboarding: OrganizationOnboardingService.create({
      ceremony,
      signals,
      createAndAssign,
      ensurePersonalWorkspace:
        (overrides as { ensurePersonalWorkspace?: typeof ensurePersonalWorkspace })
          .ensurePersonalWorkspace ?? ensurePersonalWorkspace,
    }),
  };
}

describe("given a customer who declared no intent", () => {
  describe("when the ceremony runs", () => {
    it("names the first project after the organization's own team", async () => {
      const { onboarding, ceremony } = harness();

      await onboarding.initialize(request(), CALLER);

      expect(ceremony.createProject).toHaveBeenCalledWith(
        expect.objectContaining({ name: TEAM.name, language: "other", framework: "other" }),
      );
    });

    /** @scenario A fresh organization gets the full standard catalog with no admin action */
    it("gives the new organization the standard tool catalogue", async () => {
      const { onboarding, ceremony } = harness();

      await onboarding.initialize(request(), CALLER);

      expect(ceremony.ensureDefaultAiToolCatalog).toHaveBeenCalledWith({
        organizationId: ORGANIZATION.id,
      });
    });

    it("provisions no personal workspace", async () => {
      const { onboarding, ensurePersonalWorkspace } = harness();

      await onboarding.initialize(request(), CALLER);

      expect(ensurePersonalWorkspace).not.toHaveBeenCalled();
    });

    it("refuses by name when the first project cannot be created", async () => {
      const { onboarding } = harness({
        createProject: vi.fn(async () => ({ success: false, projectSlug: "" })),
      });

      await expect(onboarding.initialize(request(), CALLER)).rejects.toMatchObject({
        code: "project_creation_failed",
      });
    });
  });
});

describe("given a customer who declared the coding-agent intent", () => {
  describe("when the ceremony runs", () => {
    /** @scenario "Governance signup creates organization and team, but no shared project" */
    it("skips the shared project and answers a null project slug", async () => {
      const { onboarding, ceremony } = harness();

      const result = await onboarding.initialize(
        request({
          orgName: "Acme Corp",
          primaryIntent: "AGENT_GOVERNANCE",
          projectName: "Acme Project",
        }),
        CALLER,
      );

      expect(ceremony.createProject).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        success: true,
        organizationId: ORGANIZATION.id,
        projectSlug: null,
      });
    });

    /** @scenario "Governance signup provisions the personal workspace" */
    it("provisions the signer's own personal workspace", async () => {
      const { onboarding, ensurePersonalWorkspace } = harness();

      await onboarding.initialize(request({ primaryIntent: "AGENT_GOVERNANCE" }), CALLER);

      expect(ensurePersonalWorkspace).toHaveBeenCalledWith(
        {
          organizationId: ORGANIZATION.id,
          displayName: CALLER.name,
          displayEmail: CALLER.email,
        },
        CALLER,
      );
    });

    /** @scenario "Failing to provision the workspace does not cost the user their organization" */
    it("completes the ceremony when the workspace cannot be provisioned", async () => {
      const failure = new Error("db down");
      const { onboarding, signals } = harness({
        ensurePersonalWorkspace: vi.fn(async () => {
          throw failure;
        }),
      } as never);

      const result = await onboarding.initialize(
        request({ primaryIntent: "AGENT_GOVERNANCE" }),
        CALLER,
      );

      expect(result).toMatchObject({ success: true, organizationId: ORGANIZATION.id });
      expect(signals.reportError).toHaveBeenCalledWith(failure, {
        extra: {
          origin: "onboarding.initializeOrganization",
          organizationId: ORGANIZATION.id,
        },
      });
    });

    it("completes the ceremony when the tool catalogue cannot be seeded", async () => {
      const failure = new Error("governance unavailable");
      const { onboarding, signals } = harness({
        ensureDefaultAiToolCatalog: vi.fn(async () => {
          throw failure;
        }),
      });

      const result = await onboarding.initialize(
        request({ primaryIntent: "AGENT_GOVERNANCE" }),
        CALLER,
      );

      expect(result).toMatchObject({ success: true });
      expect(signals.reportError).toHaveBeenCalledWith(failure, {
        extra: {
          origin: "onboarding.initializeOrganization.ensureDefaultCatalog",
          organizationId: ORGANIZATION.id,
        },
      });
    });
  });
});

describe("given a customer who declared the LLM-app intent", () => {
  describe("when the ceremony runs", () => {
    /** @scenario "LLMOps signup still creates the default project" */
    it("still creates the default project", async () => {
      const { onboarding, ceremony } = harness();

      const result = await onboarding.initialize(request({ primaryIntent: "LLM_OPS" }), CALLER);

      expect(ceremony.createProject).toHaveBeenCalledTimes(1);
      expect(result.projectSlug).toBe("acme-project");
    });

    /** @scenario "LLMOps signup provisions no personal workspace" */
    it("provisions no personal workspace", async () => {
      const { onboarding, ensurePersonalWorkspace } = harness();

      await onboarding.initialize(request({ primaryIntent: "LLM_OPS" }), CALLER);

      expect(ensurePersonalWorkspace).not.toHaveBeenCalled();
    });

    /** @scenario "LLMOps signup produces the same marketing data as today" */
    it("forwards the questionnaire untouched, with the intent as a sibling field", async () => {
      const { onboarding, createAndAssign } = harness();
      const signUpData = { utmCampaign: "launch-week", yourRole: "Engineer" };

      await onboarding.initialize(
        request({
          orgName: "Acme Corp",
          phoneNumber: "+31 20 123 4567",
          primaryIntent: "LLM_OPS",
          signUpData,
          projectName: "Acme Project",
        }),
        CALLER,
      );

      expect(createAndAssign).toHaveBeenCalledWith(
        {
          orgName: "Acme Corp",
          phoneNumber: "+31 20 123 4567",
          signUpData,
          primaryIntent: "LLM_OPS",
          userDisplayName: CALLER.name,
        },
        CALLER,
      );
    });
  });
});

describe("given the sign-up succeeded", () => {
  describe("when the announcements are filed", () => {
    it("files the sign-up with both notification doors", async () => {
      const { onboarding, signals } = harness();
      const signUpData = { utmCampaign: "launch-week" };

      await onboarding.initialize(
        request({ orgName: "Acme Corp", phoneNumber: "+31 20 123 4567", signUpData }),
        CALLER,
      );

      const payload = {
        userName: CALLER.name,
        userEmail: CALLER.email,
        organizationName: ORGANIZATION.name,
        phoneNumber: "+31 20 123 4567",
        signUpData,
      };

      expect(signals.sendSlackSignupEvent).toHaveBeenCalledWith(payload);
      expect(signals.sendHubspotSignupForm).toHaveBeenCalledWith(payload);
    });

    it("completes the ceremony when a notification door is down", async () => {
      const failure = new Error("Slack down");
      const { onboarding, signals } = harness({
        sendSlackSignupEvent: vi.fn(async () => {
          throw failure;
        }),
      });

      const result = await onboarding.initialize(request({ orgName: "Acme Corp" }), CALLER);

      expect(result.success).toBe(true);
      expect(signals.reportError).toHaveBeenCalledWith(failure);
    });

    /** @scenario "Nurturing receives the intent as an explicit trait" */
    it("identifies the customer to nurturing with the intent beside the questionnaire", async () => {
      const { onboarding, signals } = harness();
      const signUpData = { terms: true };

      await onboarding.initialize(
        request({ orgName: "Acme Corp", primaryIntent: "AGENT_GOVERNANCE", signUpData }),
        CALLER,
      );

      expect(signals.fireSignupNurturing).toHaveBeenCalledWith({
        userId: CALLER.id,
        email: CALLER.email,
        name: CALLER.name,
        organizationId: ORGANIZATION.id,
        organizationName: ORGANIZATION.name,
        signUpData,
        primaryIntent: "AGENT_GOVERNANCE",
      });
    });
  });
});
