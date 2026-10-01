import { OrganizationInvalidCredentialsError } from "@langwatch/api";
import {
  canonicalErrorResponse,
  CliTokenIdentity,
  createRestRuntime,
  type CliTokenHolder,
} from "@langwatch/api/rest";
import type { AuthzPermission } from "@langwatch/authorization";
import {
  NoEligibleProvidersError,
  PersonalVirtualKeyAlreadyExistsError,
  type EnterpriseGatewayApi,
} from "@langwatch/enterprise-gateway-contract";
import {
  IngestionKeyNotFoundError,
  IngestionKeySourceNotAllowedError,
  type GovernanceRestApi,
} from "@langwatch/enterprise-governance-contract";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { TeamNotFoundError } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * `/api/auth/cli`: who each route admits, in which order, and the
 * `{ error, error_description }` bodies released `langwatch` builds parse. The
 * bearer itself is refused at the CLI token door, in the framework's body.
 * Spec: specs/ai-gateway/cli-token-revoke-on-deactivation.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";

import type { DefaultGovernanceAiToolCatalogService } from "../../services/ai-tool-catalog.service.ts";
import { GovernanceCliAccessService } from "../../services/governance-cli-access.service.ts";
import { GovernanceCliActivityService } from "../../services/governance-cli-activity.service.ts";
import { GovernanceCliCredentialService } from "../../services/governance-cli-credentials.service.ts";
import type { DefaultGovernanceCliBootstrapService } from "../../services/governance-cli-tool-bootstrap.service.ts";
import { GovernanceCliService } from "../../services/governance-cli.service.ts";
import type { DefaultGovernanceSetupStateService } from "../../services/governance-setup-state.service.ts";
import type { ActivityMonitorService } from "../../services/ingestion-source-activity.service.ts";
import type { IngestionSourceService } from "../../services/ingestion-source.service.ts";
import type { IngestionTemplateService } from "../../services/ingestion-template.service.ts";
import type { PersonalIngestionKeyService } from "../../services/personal-ingestion-key.service.ts";
import { governanceCliRest } from "../governance-cli.rest.ts";

const USER_ID = "user_1";
const ORGANIZATION_ID = "org_1";
const BEARER = "Bearer lw_at_token";

const TOKEN_KEY = "lwcli:access:lw_at_token";

const HOLDER: CliTokenHolder = {
  userId: USER_ID,
  organizationId: ORGANIZATION_ID,
  tokenKey: TOKEN_KEY,
  clientInfo: { hostname: "laptop" },
};

const PROJECT = {
  id: "project_1",
  slug: "the-project",
  name: "The Project",
  isPersonal: false,
  ownerUserId: null,
  apiKey: "lw-base-key-secret",
};

type World = {
  personalKeys?: Partial<
    Pick<
      EnterpriseGatewayApi,
      "personalVirtualKeyList" | "personalVirtualKeyEnsureDefault" | "personalVirtualKeyIssue"
    >
  >;
  ingestionKeys?: Partial<
    Pick<PersonalIngestionKeyService, "issueForProject" | "mint" | "list" | "getPersonalKeyState">
  >;
  sources?: Partial<Pick<IngestionSourceService, "list" | "getById">>;
  templates?: Partial<Pick<IngestionTemplateService, "listForUser">>;
  users?: Partial<Pick<UserApi, "findById">>;
  organizations?: Partial<Pick<OrganizationApi, "isMember">>;
  projects?: Partial<Pick<ProjectApi, "findLiveByRef">>;
  budgets?: Partial<Pick<GatewayApi, "checkBudget" | "budgetOverviewForUser">>;
  verify?: () => Promise<CliTokenHolder>;
  planType?: string;
  permittedOnOrganization?: boolean;
  permittedOnProject?: (input: {
    userId: string;
    projectId: string;
    permission: AuthzPermission;
  }) => Promise<boolean>;
  supportContact?: string | null;
  ensurePersonalWorkspace?: () => Promise<{
    team: { id: string };
    project: { id: string; slug: string; name: string; apiKey: string };
  }>;
  personalWorkspace?: {
    team: { id: string };
    project: { id: string; slug: string; name: string; apiKey: string };
  } | null;
};

const BOB = {
  id: USER_ID,
  name: "Bob",
  email: "bob@acme.test",
  emailVerified: true,
  image: null,
  pendingSsoSetup: false,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  lastLoginAt: null,
  deactivatedAt: null,
};

function mountCli(world: World = {}) {
  const revoke = vi.fn().mockResolvedValue({ revokedCount: 1 });
  const permittedOnProject = world.permittedOnProject ?? vi.fn().mockResolvedValue(true);
  const users = createApiFixture<Pick<UserApi, "findById">>({
    findById: vi.fn().mockResolvedValue(BOB),
    ...world.users,
  });
  const organizations = createApiFixture<Pick<OrganizationApi, "isMember">>({
    isMember: vi.fn().mockResolvedValue(true),
    ...world.organizations,
  });
  const projects = createApiFixture<Pick<ProjectApi, "findLiveByRef">>({
    findLiveByRef: vi.fn().mockResolvedValue([PROJECT]),
    ...world.projects,
  });
  const budgets = createApiFixture<Pick<GatewayApi, "checkBudget" | "budgetOverviewForUser">>({
    checkBudget: vi.fn().mockResolvedValue({ decision: "allow", blockedBy: [] }),
    ...world.budgets,
  });
  const personalKeys = createApiFixture<
    Pick<
      EnterpriseGatewayApi,
      "personalVirtualKeyList" | "personalVirtualKeyEnsureDefault" | "personalVirtualKeyIssue"
    >
  >(world.personalKeys, "personalKeys");
  const ingestionKeys = createApiFixture<
    Pick<PersonalIngestionKeyService, "issueForProject" | "mint" | "list" | "getPersonalKeyState">
  >(world.ingestionKeys, "ingestionKeys");
  const plans = (): PlanProvider => ({
    getActivePlan: vi.fn().mockResolvedValue({ type: world.planType ?? "ENTERPRISE" }),
  });

  const cli = GovernanceCliService.create({
    access: GovernanceCliAccessService.create({
      sessions: { revokeCliTokens: revoke },
      users,
      organizations,
      plans,
      permittedOnOrganization: () => Promise.resolve(world.permittedOnOrganization ?? true),
      publicBaseUrl: "https://app.test",
    }),
    credentials: GovernanceCliCredentialService.create({
      personalKeys,
      ingestionKeys,
      aiTools: createApiFixture<Pick<DefaultGovernanceAiToolCatalogService, "resolveToolPolicy">>(
        {},
        "aiTools",
      ),
      users,
      projects,
      supportContacts: () => ({
        findSupportContact: vi.fn().mockResolvedValue(world.supportContact ?? null),
      }),
      ensurePersonalWorkspace:
        world.ensurePersonalWorkspace ??
        (() => Promise.reject(new Error("not reachable through the CLI door"))),
      getPersonalWorkspace: vi.fn(async () => {
        if (!world.personalWorkspace) throw new TeamNotFoundError();
        return world.personalWorkspace;
      }),
      permittedOnProject,
      budgets,
      publicBaseUrl: "https://app.test",
    }),
    activity: GovernanceCliActivityService.create({
      sources: createApiFixture<Pick<IngestionSourceService, "list" | "getById">>(
        world.sources,
        "sources",
      ),
      activity: createApiFixture<
        Pick<ActivityMonitorService, "eventsForSource" | "sourceHealthMetrics">
      >({}, "activity"),
    }),
    bootstraps: createApiFixture<Pick<DefaultGovernanceCliBootstrapService, "resolve">>(
      {},
      "bootstraps",
    ),
    budgets,
    setupState: createApiFixture<Pick<DefaultGovernanceSetupStateService, "resolve">>(
      {},
      "setupState",
    ),
    templates: createApiFixture<Pick<IngestionTemplateService, "listForUser">>(
      world.templates,
      "templates",
    ),
    ingestionKeys,
  });
  const app = createApiFixture<GovernanceRestApi>(
    {
      cliBudgetStatus: (input) => cli.budgetStatus(input),
      cliBootstrapRead: (input) => cli.bootstrap(input),
      cliBudgetOverview: (input) => cli.budgetOverview(input),
      cliPersonalProject: (input) => cli.personalProject(input),
      cliVirtualKey: (input) => cli.virtualKey(input),
      cliIngestionSources: (input) => cli.ingestionSources(input),
      cliIngestionSourceEvents: (input) => cli.ingestionSourceEvents(input),
      cliIngestionSourceHealth: (input) => cli.ingestionSourceHealth(input),
      cliGovernanceStatus: (input) => cli.governanceStatus(input),
      cliIngestionTemplates: (input) => cli.ingestionTemplates(input),
      cliIngestionKey: (input) => cli.ingestionKey(input),
      cliIngestionKeys: (input) => cli.ingestionKeys(input),
      cliIngestionKeyState: (input) => cli.ingestionKeyState(input),
    },
    "GovernanceRestApi",
  );

  const runtime = createRestRuntime({
    identity: CliTokenIdentity.create({ verify: world.verify ?? (() => Promise.resolve(HOLDER)) }),
  });
  const hono = runtime.mount(governanceCliRest.router(), {
    app: () => app,
    onError: canonicalErrorResponse,
  });
  const fetchAt = async (path: string, init?: RequestInit): Promise<Response> =>
    hono.fetch(new Request(`http://api.test${path}`, init));

  return {
    revoke,
    permittedOnProject,
    get: (path: string, headers: Record<string, string> = { Authorization: BEARER }) =>
      fetchAt(path, { headers }),
    post: (path: string, body: unknown) =>
      fetchAt(path, {
        method: "POST",
        headers: { Authorization: BEARER, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
  };
}

describe("the CLI governance plane", () => {
  describe("given a bearer the access-token store does not know", () => {
    /** @scenario After deactivation, /budget/status returns 401 for the revoked access_token */
    it("refuses at the CLI token door with 401 and reads nothing", async () => {
      const personalVirtualKeyList = vi.fn().mockResolvedValue([]);
      const api = mountCli({
        verify: () => Promise.reject(new OrganizationInvalidCredentialsError()),
        personalKeys: { personalVirtualKeyList },
      });

      const response = await api.get("/api/auth/cli/budget/status");

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({ code: "invalid_credentials" });
      expect(personalVirtualKeyList).not.toHaveBeenCalled();
    });
  });

  describe("given no bearer at all", () => {
    it("refuses at the CLI token door as missing credentials", async () => {
      const response = await mountCli().get("/api/auth/cli/budget/status", {});

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({ code: "missing_credentials" });
    });
  });

  describe("given an organization that is not on the Enterprise plan", () => {
    it("answers 402 with the upgrade page inline and never reads the sources", async () => {
      const ingestionSourceList = vi.fn().mockResolvedValue([]);
      const api = mountCli({ planType: "FREE", sources: { list: ingestionSourceList } });

      const response = await api.get("/api/auth/cli/governance/ingest/sources");

      expect(response.status).toBe(402);
      await expect(response.json()).resolves.toMatchObject({
        error: "payment_required",
        upgrade_url: "https://app.test/settings/subscription",
      });
      expect(ingestionSourceList).not.toHaveBeenCalled();
    });
  });

  describe("given a member without the organization permission the route names", () => {
    it("answers 403 and never reads the sources", async () => {
      const ingestionSourceList = vi.fn().mockResolvedValue([]);
      const api = mountCli({
        permittedOnOrganization: false,
        sources: { list: ingestionSourceList },
      });

      const response = await api.get("/api/auth/cli/governance/ingest/sources");

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        error: "forbidden",
        error_description:
          "Missing required permission 'ingestionSources:view' on this organization",
      });
      expect(ingestionSourceList).not.toHaveBeenCalled();
    });
  });

  describe("given a caller whose seat in the token's organization has ended", () => {
    it("refuses the mint, severs the presented session, and mints nothing", async () => {
      const ingestionKeyIssueForPersonalProject = vi.fn();
      const api = mountCli({
        organizations: { isMember: vi.fn().mockResolvedValue(false) },
        ingestionKeys: { mint: ingestionKeyIssueForPersonalProject },
      });

      const response = await api.post("/api/auth/cli/governance/ingestion-key", {
        source_type: "internal_codex",
      });

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        error: "forbidden",
        error_description:
          "Your access to this organization has ended. Run `langwatch login` to sign in again.",
      });
      expect(api.revoke).toHaveBeenCalledWith({ userId: USER_ID, tokenKeys: [TOKEN_KEY] });
      expect(ingestionKeyIssueForPersonalProject).not.toHaveBeenCalled();
    });
  });

  describe("when the CLI mints a personal ingestion key", () => {
    /** @scenario A personal key is minted only for a tool the CLI wraps */
    it("answers 400 for a source type no wrapped tool stamps, and mints nothing", async () => {
      const ingestionKeyIssueForPersonalProject = vi
        .fn()
        .mockRejectedValue(new IngestionKeySourceNotAllowedError("spreadsheet"));
      const api = mountCli({ ingestionKeys: { mint: ingestionKeyIssueForPersonalProject } });

      const response = await api.post("/api/auth/cli/governance/ingestion-key", {
        source_type: "spreadsheet",
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "invalid_request",
        error_description:
          "No personal ingestion key is minted for source type spreadsheet. Personal keys are minted for the tools the LangWatch CLI wraps.",
      });
    });

    /** @scenario Two devices each keep a live personal key for the same tool */
    it("mints create-only, so no other device's key is rotated away", async () => {
      const ingestionKeyIssueForPersonalProject = vi
        .fn()
        .mockResolvedValue({ token: "ik-lw-abc_secret", prefix: "ik-lw-abc" });
      const api = mountCli({ ingestionKeys: { mint: ingestionKeyIssueForPersonalProject } });

      const response = await api.post("/api/auth/cli/governance/ingestion-key", {
        source_type: "internal_codex",
      });

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toEqual({
        token: "ik-lw-abc_secret",
        prefix: "ik-lw-abc",
        endpoint: "https://app.test/api/otel",
      });
      expect(ingestionKeyIssueForPersonalProject).toHaveBeenCalledWith(
        expect.objectContaining({ createdByDeviceLabel: "laptop", fromCliSession: true }),
      );
    });
  });

  describe("when the CLI asks for a personal virtual key", () => {
    const workspace = {
      team: { id: "team-personal" },
      project: { id: "project-personal", slug: "personal-bob", name: "Bob", apiKey: "pk" },
    };

    /** @scenario A second machine asks for a key of its own */
    it("issues a further key named after the device once the default exists", async () => {
      const personalVirtualKeyIssue = vi.fn().mockResolvedValue({
        virtualKey: { id: "vk_desktop", displayPrefix: "lw_vk_desk" },
        secret: "lw_vk_desk_secret",
      });
      const api = mountCli({
        personalKeys: {
          personalVirtualKeyEnsureDefault: vi
            .fn()
            .mockRejectedValue(new PersonalVirtualKeyAlreadyExistsError("vk_default")),
          personalVirtualKeyIssue,
        },
        ensurePersonalWorkspace: async () => workspace,
      });

      const response = await api.post("/api/auth/cli/virtual-key", { device_label: "desktop" });

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toEqual({
        id: "vk_desktop",
        secret: "lw_vk_desk_secret",
        prefix: "lw_vk_desk",
      });
      expect(personalVirtualKeyIssue).toHaveBeenCalledWith(
        expect.objectContaining({ userId: USER_ID, label: "device-desktop" }),
      );
    });

    /** @scenario Asking for a personal virtual key with no providers configured is refused */
    it("answers 409 no_eligible_providers and issues no key", async () => {
      const personalVirtualKeyIssue = vi.fn();
      const api = mountCli({
        personalKeys: {
          personalVirtualKeyEnsureDefault: vi
            .fn()
            .mockRejectedValue(new NoEligibleProvidersError("org_1")),
          personalVirtualKeyIssue,
        },
      });

      const response = await api.post("/api/auth/cli/virtual-key", {});

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({ error: "no_eligible_providers" });
      expect(personalVirtualKeyIssue).not.toHaveBeenCalled();
    });
  });

  describe("when the CLI mints an ingestion key for a named project", () => {
    const issued = { token: "ik-lw-abc_secret", prefix: "ik-lw-abc" };
    const mintFor = (project: string) => ({ source_type: "internal_codex", project });

    /** @scenario The CLI mints an ingestion key for a project named by id */
    it("answers 201 with the token, endpoint and resolved project, bound to that project", async () => {
      const issueForProject = vi.fn().mockResolvedValue(issued);
      const api = mountCli({ ingestionKeys: { issueForProject } });

      const response = await api.post(
        "/api/auth/cli/governance/ingestion-key",
        mintFor(PROJECT.id),
      );

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toEqual({
        ...issued,
        endpoint: "https://app.test/api/otel",
        project: { id: PROJECT.id, slug: PROJECT.slug, name: PROJECT.name },
      });
      expect(issueForProject).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: PROJECT.id, ownerUserId: null }),
      );
    });

    /** @scenario The CLI mints an ingestion key for a project named by slug */
    it("resolves the reference inside the caller's organization, so a slug works too", async () => {
      const findLiveByRef = vi.fn().mockResolvedValue([PROJECT]);
      const api = mountCli({
        ingestionKeys: { issueForProject: vi.fn().mockResolvedValue(issued) },
        projects: { findLiveByRef },
      });

      const response = await api.post(
        "/api/auth/cli/governance/ingestion-key",
        mintFor(PROJECT.slug),
      );

      expect(response.status).toBe(201);
      expect(findLiveByRef).toHaveBeenCalledWith({
        projectRef: PROJECT.slug,
        organizationId: ORGANIZATION_ID,
      });
    });

    /** @scenario Minting into a project the caller cannot write to is refused */
    it("answers 403 forbidden and mints nothing without traces:create on it", async () => {
      const issueForProject = vi.fn();
      const api = mountCli({
        ingestionKeys: { issueForProject },
        permittedOnProject: vi.fn().mockResolvedValue(false),
      });

      const response = await api.post(
        "/api/auth/cli/governance/ingestion-key",
        mintFor(PROJECT.slug),
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({ error: "forbidden" });
      expect(api.permittedOnProject).toHaveBeenCalledWith({
        userId: USER_ID,
        projectId: PROJECT.id,
        permission: "traces:create",
      });
      expect(issueForProject).not.toHaveBeenCalled();
    });

    /** @scenario A project in another organization is not found */
    it("answers 404 project_not_found for a project its organization does not hold", async () => {
      const issueForProject = vi.fn();
      const api = mountCli({
        ingestionKeys: { issueForProject },
        projects: { findLiveByRef: vi.fn().mockResolvedValue([]) },
      });

      const response = await api.post(
        "/api/auth/cli/governance/ingestion-key",
        mintFor("other-co-api"),
      );

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ error: "project_not_found" });
      expect(issueForProject).not.toHaveBeenCalled();
    });
  });

  describe("when a CLI that sent no device metadata mints a personal ingestion key", () => {
    /** @scenario "A personal ingestion key minted by a CLI without device metadata is named for an unknown device" */
    it("labels the key unknown-device, as its login key is labelled", async () => {
      const mint = vi.fn().mockResolvedValue({ token: "ik-lw-abc_secret", prefix: "ik-lw-abc" });
      const api = mountCli({
        ingestionKeys: { mint },
        verify: () =>
          Promise.resolve({
            userId: USER_ID,
            organizationId: ORGANIZATION_ID,
            tokenKey: TOKEN_KEY,
          }),
      });

      const response = await api.post("/api/auth/cli/governance/ingestion-key", {
        source_type: "copilot_app",
      });

      expect(response.status).toBe(201);
      expect(mint).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceType: "copilot_app",
          createdByDeviceLabel: "unknown-device",
        }),
      );
    });
  });

  describe("when the CLI asks what became of one of its own keys", () => {
    /** @scenario The CLI can ask what became of its own key */
    it("answers with the cause for a revoked key and unknown for one it does not hold", async () => {
      const revoked = mountCli({
        ingestionKeys: {
          getPersonalKeyState: vi.fn().mockResolvedValue({
            live: false,
            sourceType: "internal_codex",
            revocationCause: "cap_retired",
          }),
        },
      });
      const absent = mountCli({
        ingestionKeys: {
          getPersonalKeyState: vi.fn().mockRejectedValue(new IngestionKeyNotFoundError("lookup-2")),
        },
      });

      const revokedResponse = await revoked.get("/api/auth/cli/governance/ingestion-keys/lookup-1");
      const absentResponse = await absent.get("/api/auth/cli/governance/ingestion-keys/lookup-2");

      expect(revokedResponse.status).toBe(200);
      await expect(revokedResponse.text()).resolves.toBe(
        '{"lookup_id":"lookup-1","status":"revoked","source_type":"internal_codex","revocation_cause":"cap_retired"}',
      );
      expect(absentResponse.status).toBe(200);
      await expect(absentResponse.text()).resolves.toBe(
        '{"lookup_id":"lookup-2","status":"unknown"}',
      );
    });
  });

  describe("when a budget binding the caller's personal key is exhausted", () => {
    it("answers 402 with the nested budget_exceeded document the CLI renders", async () => {
      const api = mountCli({
        supportContact: "admin@acme.test",
        personalWorkspace: {
          team: { id: "team_1" },
          project: { id: "project_personal", slug: "bob", name: "Bob", apiKey: "k" },
        },
        budgets: {
          checkBudget: vi.fn().mockResolvedValue({
            decision: "hard_block",
            blockedBy: [
              {
                scope: "ORGANIZATION",
                scopeId: ORGANIZATION_ID,
                limitUsd: "100.00",
                spentUsd: "120.00",
                window: "MONTHLY",
              },
            ],
          }),
        },
        personalKeys: { personalVirtualKeyList: vi.fn().mockResolvedValue([{ id: "vk_1" }]) },
      });

      const response = await api.get("/api/auth/cli/budget/status");

      expect(response.status).toBe(402);
      await expect(response.json()).resolves.toEqual({
        error: {
          type: "budget_exceeded",
          scope: "organization",
          limit_usd: "100.00",
          spent_usd: "120.00",
          period: "monthly",
          request_increase_url:
            "https://app.test/me/budget/request?scope=organization&scope_id=org_1&limit_usd=100.00&spent_usd=120.00",
          admin_email: "admin@acme.test",
        },
      });
    });

    it("reads clear when no budget blocks the personal key", async () => {
      const api = mountCli({
        personalWorkspace: {
          team: { id: "team_1" },
          project: { id: "project_personal", slug: "bob", name: "Bob", apiKey: "k" },
        },
        personalKeys: { personalVirtualKeyList: vi.fn().mockResolvedValue([{ id: "vk_1" }]) },
      });

      const response = await api.get("/api/auth/cli/budget/status");

      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toBe('{"ok":true}');
    });
  });

  describe("when the CLI lists the organization's ingestion templates", () => {
    it("answers the snake_case envelope, distinct from the project-key door's", async () => {
      const api = mountCli({
        templates: {
          listForUser: vi.fn().mockResolvedValue([
            {
              id: "tmpl_1",
              organizationId: ORGANIZATION_ID,
              slug: "claude_code",
              sourceType: "claude_code",
              displayName: "Claude Code",
              description: null,
              iconAsset: null,
              credentialSchema: null,
              ottlRules: "",
              platformPublished: false,
              enabled: true,
            },
          ]),
        },
      });

      const response = await api.get("/api/auth/cli/governance/ingestion-templates");

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        ingestion_templates: [
          {
            id: "tmpl_1",
            organization_id: ORGANIZATION_ID,
            slug: "claude_code",
            source_type: "claude_code",
            display_name: "Claude Code",
            description: null,
            icon_asset: null,
            credential_schema: null,
            ottl_rules: "",
            platform_published: false,
            enabled: true,
          },
        ],
      });
    });
  });
});

const PERSONAL_WORKSPACE = {
  team: { id: "team_personal" },
  project: { id: "project_personal", slug: "bob", name: "Bob", apiKey: "lw-personal-key-secret" },
};
const OFFBOARDED = { isMember: vi.fn().mockResolvedValue(false) };

describe("the CLI credential routes' tenancy boundary", () => {
  describe("given a caller who can administer their own personal project", () => {
    /** @scenario GET /api/auth/cli/personal-project returns the caller's personal project */
    it("returns its id, slug and name, never a key", async () => {
      const api = mountCli({ ensurePersonalWorkspace: async () => PERSONAL_WORKSPACE });

      const response = await api.get("/api/auth/cli/personal-project");

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        project: { id: "project_personal", slug: "bob", name: "Bob" },
      });
    });
  });

  describe("given an old CLI asking for a project key", () => {
    /** @scenario An old CLI asking for a project key is told to upgrade */
    it("answers 410 gone with the upgrade hint", async () => {
      const api = mountCli({ ensurePersonalWorkspace: async () => PERSONAL_WORKSPACE });

      const response = await api.post("/api/auth/cli/project-key", { slug: "bob" });

      expect(response.status).toBe(410);
      await expect(response.json()).resolves.toMatchObject({
        error: "gone",
        error_description:
          "This version of the LangWatch CLI is too old to log in to a project. Run: npm i -g langwatch@latest",
      });
    });
  });

  describe("given a token issued before its user was removed from the organization", () => {
    /** @scenario an offboarded user's pre-removal token cannot mint or return a personal key */
    it("answers 403, creates no workspace, revokes the token and refuses it afterwards", async () => {
      const ensure = vi.fn().mockResolvedValue(PERSONAL_WORKSPACE);
      let revoked = () => false;
      const api = mountCli({
        organizations: OFFBOARDED,
        ensurePersonalWorkspace: ensure,
        verify: () =>
          revoked()
            ? Promise.reject(new OrganizationInvalidCredentialsError())
            : Promise.resolve(HOLDER),
      });
      revoked = () => api.revoke.mock.calls.length > 0;

      const first = await api.get("/api/auth/cli/personal-project");

      expect(first.status).toBe(403);
      expect(await first.text()).not.toContain(PERSONAL_WORKSPACE.project.apiKey);
      expect(ensure).not.toHaveBeenCalled();
      expect(api.revoke).toHaveBeenCalledWith({ userId: USER_ID, tokenKeys: [TOKEN_KEY] });
      const followUp = await api.get("/api/auth/cli/personal-project");
      expect(followUp.status).toBe(401);
    });
  });

  describe("given a token issued while the member was active, whose seat an admin then disabled", () => {
    /** @scenario a disabled member's pre-disable token cannot mint or return a personal key */
    it("answers 403, creates no workspace and revokes the presented token", async () => {
      const ensure = vi.fn().mockResolvedValue(PERSONAL_WORKSPACE);
      const api = mountCli({ organizations: OFFBOARDED, ensurePersonalWorkspace: ensure });

      const response = await api.get("/api/auth/cli/personal-project");

      expect(response.status).toBe(403);
      expect(ensure).not.toHaveBeenCalled();
      expect(api.revoke).toHaveBeenCalledWith({ userId: USER_ID, tokenKeys: [TOKEN_KEY] });
    });
  });

  describe("given a token for a user whose account is deactivated", () => {
    /** @scenario a deactivated user's token cannot mint or return a personal key */
    it("answers 403, creates no workspace and revokes the presented token", async () => {
      const ensure = vi.fn().mockResolvedValue(PERSONAL_WORKSPACE);
      const api = mountCli({
        users: { findById: vi.fn().mockResolvedValue({ ...BOB, deactivatedAt: new Date(1) }) },
        ensurePersonalWorkspace: ensure,
      });

      const response = await api.get("/api/auth/cli/personal-project");

      expect(response.status).toBe(403);
      expect(ensure).not.toHaveBeenCalled();
      expect(api.revoke).toHaveBeenCalledWith({ userId: USER_ID, tokenKeys: [TOKEN_KEY] });
    });
  });
});
