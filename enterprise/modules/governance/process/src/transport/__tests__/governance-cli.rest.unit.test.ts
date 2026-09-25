import { OrganizationInvalidCredentialsError } from "@langwatch/api";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * `/api/auth/cli`: who each route admits, in which order, and the
 * `{ error, error_description }` bodies released `langwatch` builds parse. The
 * bearer itself is refused at the CLI token door, in the framework's body.
 * Spec: specs/ai-gateway/cli-token-revoke-on-deactivation.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import {
  canonicalErrorResponse,
  CliTokenIdentity,
  createRestRuntime,
  type CliTokenHolder,
} from "@langwatch/api/rest";
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { EnterpriseGatewayApi } from "@langwatch/enterprise-gateway-contract";
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
  projects?: Partial<Pick<ProjectApi, "findLiveBySlug" | "findLiveByRef">>;
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
  const projects = createApiFixture<Pick<ProjectApi, "findLiveBySlug" | "findLiveByRef">>({
    findLiveBySlug: vi.fn().mockResolvedValue([PROJECT]),
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
      ensurePersonalWorkspace: () =>
        Promise.reject(new Error("not reachable through the CLI door")),
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
      cliProjectKey: (input) => cli.projectKey(input),
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

  describe("given a caller who can update but not administer the project", () => {
    /** @scenario A project member cannot read the base key */
    it("refuses the handout and discloses no base API key", async () => {
      const api = mountCli({ permittedOnProject: vi.fn().mockResolvedValue(false) });

      const response = await api.post("/api/auth/cli/project-key", { slug: PROJECT.slug });

      expect(response.status).toBe(403);
      expect(await response.text()).not.toContain(PROJECT.apiKey);
    });

    it("asks for project:manage, not project:update", async () => {
      const api = mountCli({ permittedOnProject: vi.fn().mockResolvedValue(false) });

      await api.post("/api/auth/cli/project-key", { slug: PROJECT.slug });

      expect(api.permittedOnProject).toHaveBeenCalledWith({
        userId: USER_ID,
        projectId: PROJECT.id,
        permission: "project:manage",
      });
    });
  });

  describe("given a caller who can administer the project", () => {
    /** @scenario A signed-in project admin reads the base key */
    it("returns the project's base API key", async () => {
      const api = mountCli();

      const response = await api.post("/api/auth/cli/project-key", { slug: PROJECT.slug });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        api_key: PROJECT.apiKey,
        project: { id: PROJECT.id, slug: PROJECT.slug, name: PROJECT.name },
      });
    });

    it("answers not_found for a slug no project in the organization carries", async () => {
      const api = mountCli({
        projects: { findLiveBySlug: vi.fn().mockResolvedValue([]) },
      });

      const response = await api.post("/api/auth/cli/project-key", { slug: "elsewhere" });

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({
        error: "not_found",
        error_description: 'No project with slug "elsewhere" in your organization',
      });
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
