/**
 * @vitest-environment node
 *
 * The `onboarding.*` surface: the sign-up ceremony, and the order and
 * conditions its steps run under.
 *
 * Every follow-up answers through a port, so this transport owns none of the
 * work. What it owns is the ceremony — which steps the declared intent selects,
 * which of them may fail without costing the customer the organization they
 * just created, what the first project is named when nobody named it, and what
 * the client is handed back. All four are what the app router used to hold.
 *
 * Spec: specs/features/onboarding/intent-fork.feature
 */
import { initTRPC, TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { OrganizationApp } from "../../../app/organization.app";
import { OnboardingTrpcApi, type OnboardingTrpcPorts } from "../onboarding.api";

const SIGN_UP_DATA_SCHEMA = z.object({
  utmCampaign: z.string().optional(),
  yourRole: z.string().optional(),
  terms: z.boolean().optional(),
});

const ORGANIZATION = { id: "org_1", name: "Acme Corp" };
const TEAM = { id: "team_1", slug: "acme-team", name: "Acme Team" };

/**
 * The process's context, narrowed to what this surface reads off it. The
 * application is the real type — `createAndAssign` is the only method the
 * ceremony calls, so the stand-in below is that one method and nothing else.
 */
type TestContext = {
  app: { organizations: OrganizationApp };
  session: { user: { id: string; name?: string | null; email?: string | null } } | null;
};

function harness(
  overrides: Partial<OnboardingTrpcPorts<typeof SIGN_UP_DATA_SCHEMA>> = {},
  organizationOverrides: { createAndAssign?: ReturnType<typeof vi.fn> } = {},
) {
  const trpc = initTRPC.context<TestContext>().create();
  // Mirrors the process's authenticated procedure: it narrows the context, so
  // the builder handed over is not the root's bare one.
  const authenticated = trpc.procedure.use(({ ctx, next }) => {
    if (!ctx.session) throw new TRPCError({ code: "UNAUTHORIZED" });
    return next({ ctx: { ...ctx, session: ctx.session } });
  });

  const declared: { reason: string }[] = [];
  const noPermission = (declaration: { reason: string }) => {
    declared.push(declaration);
    return <TProcedure>(procedure: TProcedure): TProcedure => procedure;
  };

  const createAndAssign =
    organizationOverrides.createAndAssign ??
    vi.fn(async () => ({ organization: ORGANIZATION, team: TEAM }));

  const ports = {
    signUpDataSchema: SIGN_UP_DATA_SCHEMA,
    ensureDefaultAiToolCatalog: vi.fn(async () => undefined),
    ensurePersonalWorkspace: vi.fn(async () => undefined),
    createProject: vi.fn(async () => ({ success: true, projectSlug: "acme-project" })),
    sendSlackSignupEvent: vi.fn(async () => undefined),
    sendHubspotSignupForm: vi.fn(async () => undefined),
    fireSignupNurturing: vi.fn(),
    recordIntegrationMethod: vi.fn(),
    reportError: vi.fn(),
    ...overrides,
  } as unknown as OnboardingTrpcPorts<typeof SIGN_UP_DATA_SCHEMA>;

  const router = OnboardingTrpcApi.create(trpc, { protected: authenticated, noPermission }, ports);

  const ctx: TestContext = {
    app: { organizations: { createAndAssign } as unknown as OrganizationApp },
    session: { user: { id: "user_1", name: "Jane Doe", email: "jane@example.com" } },
  };

  return {
    declared,
    ports,
    createAndAssign,
    caller: router.createCaller(ctx),
    anonymousCaller: router.createCaller({ ...ctx, session: null }),
    router,
  };
}

describe("OnboardingTrpcApi", () => {
  describe("given the surface is mounted", () => {
    it("answers on the two names the sign-up screens call", () => {
      const { router } = harness();

      expect(Object.keys(router._def.procedures).sort()).toEqual([
        "initializeOrganization",
        "setIntegrationMethod",
      ]);
    });

    it("declares the same written opt-out for both procedures", () => {
      const { declared } = harness();

      expect(declared).toEqual([
        { reason: "onboarding runs before the user belongs to any organization" },
        { reason: "onboarding runs before the user belongs to any organization" },
      ]);
    });

    it("refuses a caller with no session", async () => {
      const { anonymousCaller } = harness();

      await expect(anonymousCaller.initializeOrganization({})).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    });
  });

  describe("given a customer with no declared intent", () => {
    it("creates the organization as the signed-in caller", async () => {
      const { caller, createAndAssign } = harness();

      await caller.initializeOrganization({ orgName: "Acme Corp" });

      expect(createAndAssign).toHaveBeenCalledWith(
        {
          orgName: "Acme Corp",
          phoneNumber: undefined,
          signUpData: undefined,
          primaryIntent: undefined,
          userDisplayName: "Jane Doe",
        },
        { id: "user_1" },
      );
    });

    it("hands the client back the team and project it lands on", async () => {
      const { caller } = harness();

      await expect(
        caller.initializeOrganization({ orgName: "Acme Corp", projectName: "Acme Project" }),
      ).resolves.toEqual({
        success: true,
        teamSlug: "acme-team",
        teamName: "Acme Team",
        teamId: "team_1",
        organizationId: "org_1",
        projectSlug: "acme-project",
      });
    });

    it("still creates a project, because absent means the legacy default", async () => {
      const { caller, ports } = harness();

      await caller.initializeOrganization({ orgName: "Acme Corp" });

      expect(ports.createProject).toHaveBeenCalledTimes(1);
    });

    it("names the project after the organization's own team when nobody named it", async () => {
      const { caller, ports } = harness();

      await caller.initializeOrganization({ orgName: "Acme Corp" });

      expect(ports.createProject).toHaveBeenCalledWith(expect.anything(), {
        organizationId: "org_1",
        teamId: "team_1",
        name: "Acme Team",
        language: "other",
        framework: "other",
      });
    });

    it("prefers the name the customer typed", async () => {
      const { caller, ports } = harness();

      await caller.initializeOrganization({ projectName: "Acme Project" });

      expect(ports.createProject).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ name: "Acme Project" }),
      );
    });

    it("defaults the language and framework the setup screens ask for", async () => {
      const { caller, ports } = harness();

      await caller.initializeOrganization({});

      expect(ports.createProject).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ language: "other", framework: "other" }),
      );
    });

    /** @scenario A fresh organization gets the full standard catalog with no admin action */
    it("gives the new organization the standard tool catalogue", async () => {
      const { caller, ports } = harness();

      await caller.initializeOrganization({});

      expect(ports.ensureDefaultAiToolCatalog).toHaveBeenCalledWith(expect.anything(), {
        organizationId: "org_1",
      });
    });

    it("provisions no personal workspace", async () => {
      const { caller, ports } = harness();

      await caller.initializeOrganization({});

      expect(ports.ensurePersonalWorkspace).not.toHaveBeenCalled();
    });

    it("refuses the ceremony when the project cannot be created", async () => {
      const { caller } = harness({
        createProject: async () => ({ success: false, projectSlug: "" }),
      });

      await expect(caller.initializeOrganization({})).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to create project",
      });
    });
  });

  describe("given a customer who declared the coding-agent intent", () => {
    /** @scenario "Governance signup creates organization and team, but no shared project" */
    it("skips the shared project and answers a null project slug", async () => {
      const { caller, ports } = harness();

      const result = await caller.initializeOrganization({
        orgName: "Acme Corp",
        primaryIntent: "AGENT_GOVERNANCE",
        projectName: "Acme Project",
      });

      expect(ports.createProject).not.toHaveBeenCalled();
      expect(result).toMatchObject({ success: true, organizationId: "org_1", projectSlug: null });
    });

    /** @scenario "Governance signup provisions the personal workspace" */
    it("provisions the signer's own personal workspace", async () => {
      const { caller, ports } = harness();

      await caller.initializeOrganization({ primaryIntent: "AGENT_GOVERNANCE" });

      expect(ports.ensurePersonalWorkspace).toHaveBeenCalledWith(expect.anything(), {
        userId: "user_1",
        organizationId: "org_1",
        displayName: "Jane Doe",
        displayEmail: "jane@example.com",
      });
    });

    /** @scenario "Failing to provision the workspace does not cost the user their organization" */
    it("completes the ceremony when the workspace cannot be provisioned", async () => {
      const failure = new Error("db down");
      const { caller, ports } = harness({
        ensurePersonalWorkspace: async () => {
          throw failure;
        },
      });

      const result = await caller.initializeOrganization({ primaryIntent: "AGENT_GOVERNANCE" });

      expect(result).toMatchObject({ success: true, organizationId: "org_1" });
      expect(ports.reportError).toHaveBeenCalledWith(failure, {
        extra: {
          origin: "onboarding.initializeOrganization",
          organizationId: "org_1",
        },
      });
    });

    it("completes the ceremony when the tool catalogue cannot be provisioned", async () => {
      const failure = new Error("governance unavailable");
      const { caller, ports } = harness({
        ensureDefaultAiToolCatalog: async () => {
          throw failure;
        },
      });

      const result = await caller.initializeOrganization({ primaryIntent: "AGENT_GOVERNANCE" });

      expect(result).toMatchObject({ success: true });
      expect(ports.reportError).toHaveBeenCalledWith(failure, {
        extra: {
          origin: "onboarding.initializeOrganization.ensureDefaultCatalog",
          organizationId: "org_1",
        },
      });
    });
  });

  describe("given a customer who declared the LLM-app intent", () => {
    /** @scenario "LLMOps signup still creates the default project" */
    it("still creates the default project", async () => {
      const { caller, ports } = harness();

      const result = await caller.initializeOrganization({ primaryIntent: "LLM_OPS" });

      expect(ports.createProject).toHaveBeenCalledTimes(1);
      expect(result.projectSlug).toBe("acme-project");
    });

    /** @scenario "LLMOps signup provisions no personal workspace" */
    it("provisions no personal workspace", async () => {
      const { caller, ports } = harness();

      await caller.initializeOrganization({ primaryIntent: "LLM_OPS" });

      expect(ports.ensurePersonalWorkspace).not.toHaveBeenCalled();
    });

    /** @scenario "LLMOps signup produces the same marketing data as today" */
    it("forwards the questionnaire untouched, with the intent as a sibling field", async () => {
      const { caller, createAndAssign } = harness();
      const signUpData = { utmCampaign: "launch-week", yourRole: "Engineer" };

      await caller.initializeOrganization({
        orgName: "Acme Corp",
        phoneNumber: "+31 20 123 4567",
        primaryIntent: "LLM_OPS",
        signUpData,
        projectName: "Acme Project",
      });

      expect(createAndAssign).toHaveBeenCalledWith(
        {
          orgName: "Acme Corp",
          phoneNumber: "+31 20 123 4567",
          signUpData,
          primaryIntent: "LLM_OPS",
          userDisplayName: "Jane Doe",
        },
        { id: "user_1" },
      );
    });
  });

  describe("given the sign-up succeeded", () => {
    it("files the sign-up with both notification doors", async () => {
      const { caller, ports } = harness();
      const signUpData = { utmCampaign: "launch-week" };

      await caller.initializeOrganization({
        orgName: "Acme Corp",
        phoneNumber: "+31 20 123 4567",
        signUpData,
      });

      const payload = {
        userName: "Jane Doe",
        userEmail: "jane@example.com",
        organizationName: "Acme Corp",
        phoneNumber: "+31 20 123 4567",
        signUpData,
      };
      expect(ports.sendSlackSignupEvent).toHaveBeenCalledWith(expect.anything(), payload);
      expect(ports.sendHubspotSignupForm).toHaveBeenCalledWith(expect.anything(), payload);
    });

    it("completes the ceremony when a notification door is down", async () => {
      const failure = new Error("Slack down");
      const { caller, ports } = harness({
        sendSlackSignupEvent: async () => {
          throw failure;
        },
      });

      const result = await caller.initializeOrganization({ orgName: "Acme Corp" });

      expect(result.success).toBe(true);
      expect(ports.reportError).toHaveBeenCalledWith(failure);
    });

    /** @scenario "Nurturing receives the intent as an explicit trait" */
    it("identifies the customer to nurturing with the intent alongside the questionnaire", async () => {
      const { caller, ports } = harness();
      const signUpData = { terms: true };

      await caller.initializeOrganization({
        orgName: "Acme Corp",
        primaryIntent: "AGENT_GOVERNANCE",
        signUpData,
      });

      expect(ports.fireSignupNurturing).toHaveBeenCalledWith({
        userId: "user_1",
        email: "jane@example.com",
        name: "Jane Doe",
        organizationId: "org_1",
        organizationName: "Acme Corp",
        signUpData,
        primaryIntent: "AGENT_GOVERNANCE",
      });
    });
  });

  describe("given the organization cannot be created", () => {
    it("reports the failure and lets it reach the caller untranslated", async () => {
      const failure = new Error("postgres unreachable");
      const { caller, ports } = harness(
        {},
        {
          createAndAssign: vi.fn(async () => {
            throw failure;
          }),
        },
      );

      // Rethrown untouched: the process's own middleware is what turns a
      // failure into a wire error, so what this pins is that nothing here
      // translated it first.
      await expect(caller.initializeOrganization({})).rejects.toMatchObject({ cause: failure });
      expect(ports.reportError).toHaveBeenCalledWith(failure);
    });
  });

  describe("given the customer picks how they want to integrate", () => {
    it("records the selection the screen offered", async () => {
      const { caller, ports } = harness();

      await expect(
        caller.setIntegrationMethod({ integrationMethod: "via-claude-code" }),
      ).resolves.toEqual({ success: true });
      expect(ports.recordIntegrationMethod).toHaveBeenCalledWith({
        userId: "user_1",
        selection: "via-claude-code",
      });
    });

    it("accepts every flavour the screen offers and nothing else", async () => {
      const { caller, ports } = harness();

      for (const selection of [
        "via-claude-code",
        "via-platform",
        "via-claude-desktop",
        "manually",
      ] as const) {
        await caller.setIntegrationMethod({ integrationMethod: selection });
      }

      expect(
        (ports.recordIntegrationMethod as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
          ([call]) => (call as { selection: string }).selection,
        ),
      ).toEqual(["via-claude-code", "via-platform", "via-claude-desktop", "manually"]);
      await expect(
        caller.setIntegrationMethod({ integrationMethod: "via-carrier-pigeon" } as never),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });
});
