import { createApiFixture } from "@langwatch/api-fixture";
import {
  bindRestHeader,
  bindRestMiddleware,
  createRestRuntime,
  type RestErrorHandler,
} from "@langwatch/api/rest";
import type { AuthApi } from "@langwatch/auth-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import {
  InvalidSourceTypeError,
  PlatformTemplateImmutableError,
  TemplateNotFoundError,
} from "@langwatch/enterprise-governance-contract";
/**
 * The governance REST door: access, wire body and dispatch per route. Ingestion templates go
 * through `IngestionTemplateService`, so `buildApi()` supplies no facade and tests seed the
 * repository.
 * @see specs/ai-gateway/governance/governance-api-cli-mcp-coverage.feature
 */
import type { ScimApi } from "@langwatch/enterprise-scim-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { HandledError } from "@langwatch/handled-error";
import { ResourceScope } from "@langwatch/kernel";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectIdentity, ProjectApi } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import type { TraceApi } from "@langwatch/trace-contract";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { describe, expect, it, vi } from "vitest";

import { GovernanceApp } from "../../app/governance.app.ts";
import type { GovernanceEncryptor } from "../../app/governance.members.ts";
import type { GovernanceMemberDatabase } from "../../governance.server.ts";
import type { NewIngestionTemplate } from "../../repositories/ingestion-template.repository.ts";
import { MemoryGovernanceRepositories } from "../../repositories/memory/memory.governance.repositories.ts";
import { governanceRest, governanceRestCaller, governanceRestSurface } from "../governance.rest.ts";

const PROJECT: ProjectIdentity = {
  id: "project-1",
  name: "Checkout",
  slug: "checkout",
  teamId: "team-1",
  organizationId: "org-1",
  isPersonal: false,
  ownerUserId: null,
};

const ORGANIZATION_ID = "org-1";
const USER_ID = "user-1";

/** The two credential classes this family authenticates, as bearer values. */
const USER_BOUND_TOKEN = "user-bound-token";
const LEGACY_PROJECT_TOKEN = "legacy-project-token";

const unreachablePrisma = createApiFixture<GovernanceMemberDatabase>();

type RequestOptions = {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
};

/** A row for `repositories.ingestionTemplates.createWithAudit` to seed directly. */
function newTemplateInput(overrides: Partial<NewIngestionTemplate> = {}): NewIngestionTemplate {
  return {
    slug: "seed_template",
    sourceType: "internal_codex",
    displayName: "Seed Template",
    description: null,
    iconAsset: null,
    credentialSchema: null,
    ottlRules: 'set(attributes["x"], "y")',
    organizationId: ORGANIZATION_ID,
    ...overrides,
  };
}

/**
 * The two things the process supplies and this package does not own: who the caller is, and how
 * a refusal is rendered. A credential the door does not recognise and a permission outside the
 * key's ceiling are both raised as handled errors, exactly as a real mount raises them.
 */
const renderHandled: RestErrorHandler = (error, c) => {
  if (HandledError.isHandled(error)) {
    return c.json(
      { error: error.code, message: error.message },
      (error.httpStatus ?? 500) as ContentfulStatusCode,
    );
  }

  return c.json({ error: "Internal server error" }, 500);
};

/** The member a presented credential names, or nothing for the legacy project token. */
function viewerOf(request: Request): string | null {
  const presented =
    request.headers.get("X-Auth-Token") ??
    request.headers.get("Authorization")?.replace(/^Bearer /, "");

  return presented === USER_BOUND_TOKEN ? USER_ID : null;
}

class TestCredentialError extends HandledError {
  constructor() {
    super("unauthorized", "Invalid credential", { httpStatus: 401 });
  }
}

class TestKeyPermissionError extends HandledError {
  constructor() {
    super("forbidden", "Outside the key's ceiling", { httpStatus: 403 });
  }
}

async function buildApi(
  options: {
    grants?: readonly string[];
  } = {},
) {
  const getOrganizationId = vi.fn(async () => ORGANIZATION_ID);
  const repositories = MemoryGovernanceRepositories.create();

  const app = await GovernanceApp.create({
    config: void 0,
    repositories,
    dependencies: {
      projects: createApiFixture<ProjectApi>({ getOrganizationId }),
      auth: createApiFixture<AuthApi>(),
      entitlements: createApiFixture<EntitlementApi>(),
      organizations: createApiFixture<OrganizationApi>(),
      permissions: createApiFixture<AuthzApi>(),
      scim: createApiFixture<ScimApi>(),
      featureFlags: createApiFixture<FeatureFlagApi>(),
      traces: createApiFixture<TraceApi>(),
    },
    members: { prisma: unreachablePrisma, encryption: createApiFixture<GovernanceEncryptor>() },
    resources: new ResourceScope(),
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
  });

  const granted = new Set(options.grants ?? ["aiTools:view", "aiTools:manage"]);
  const refusals: string[] = [];

  const runtime = createRestRuntime({
    identity: {
      authenticate: ({ request, permission }) => {
        const presented =
          request.headers.get("X-Auth-Token") ??
          request.headers.get("Authorization")?.replace(/^Bearer /, "");

        if (presented !== USER_BOUND_TOKEN && presented !== LEGACY_PROJECT_TOKEN) {
          throw new TestCredentialError();
        }

        if (!granted.has(permission)) {
          refusals.push(permission);
          throw new TestKeyPermissionError();
        }

        return {
          actor: null,
          scope: { tier: "project", id: PROJECT.id } as const,
        };
      },
    },
  });

  const hono = runtime.mount(governanceRest.router(), {
    app: () => app,
    credential: "project",
    onError: renderHandled,
    facts: [
      bindRestMiddleware(governanceRestCaller, (context) => ({
        viewerUserId: viewerOf(context.req.raw),
      })),
      bindRestHeader(governanceRestSurface, "X-LangWatch-Surface"),
    ],
  });

  const requestWith =
    (token: string, header: string) =>
    (path: string, init: RequestOptions = {}) =>
      hono.request(path, {
        ...(init.method === undefined ? {} : { method: init.method }),
        ...(init.body === undefined ? {} : { body: init.body }),
        headers: {
          [header]: token,
          "Content-Type": "application/json",
          ...init.headers,
        },
      });

  return {
    hono,
    refusals,
    getOrganizationId,
    repositories,
    asUser: requestWith(`Bearer ${USER_BOUND_TOKEN}`, "Authorization"),
    asProjectKey: requestWith(LEGACY_PROJECT_TOKEN, "X-Auth-Token"),
  };
}

describe("the governance REST family", () => {
  describe("given no credential", () => {
    it("refuses before the request reaches the application", async () => {
      const { hono, repositories } = await buildApi();
      const listUserVisible = vi.spyOn(repositories.ingestionTemplates, "listUserVisible");

      const response = await hono.request("/api/governance/ingestion-templates");

      expect(response.status).toBe(401);
      expect(listUserVisible).not.toHaveBeenCalled();
    });

    it("refuses a credential it does not recognise", async () => {
      const { hono } = await buildApi();

      const response = await hono.request("/api/governance/ingestion-templates", {
        headers: { "X-Auth-Token": "not-a-real-key" },
      });

      expect(response.status).toBe(401);
    });
  });

  describe("given a legacy project key, which is bound to a project and not to a person", () => {
    it("still serves the member-facing template list", async () => {
      const { asProjectKey, repositories } = await buildApi();
      const listUserVisible = vi.spyOn(repositories.ingestionTemplates, "listUserVisible");

      const response = await asProjectKey("/api/governance/ingestion-templates");

      expect(response.status).toBe(200);
      expect(listUserVisible).toHaveBeenCalledWith(ORGANIZATION_ID);
    });

    it("refuses the admin list as user_token_required and reads nothing", async () => {
      const { asProjectKey, repositories } = await buildApi();
      const listAdminVisible = vi.spyOn(repositories.ingestionTemplates, "listAdminVisible");

      const response = await asProjectKey("/api/governance/ingestion-templates/admin");

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        error: "user_token_required",
        message: expect.any(String),
      });
      expect(listAdminVisible).not.toHaveBeenCalled();
    });

    it("refuses creating an organization template and writes nothing", async () => {
      const { asProjectKey, repositories } = await buildApi();
      const createWithAudit = vi.spyOn(repositories.ingestionTemplates, "createWithAudit");

      const response = await asProjectKey("/api/governance/ingestion-templates", {
        method: "POST",
        body: JSON.stringify({
          source_type: "internal_codex",
          display_name: "Should Be Forbidden",
        }),
      });

      expect(response.status).toBe(403);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("user_token_required");
      expect(createWithAudit).not.toHaveBeenCalled();
    });
  });

  describe("given a credential whose ceiling does not carry the route's permission", () => {
    it("refuses the manage routes and leaves the view routes reachable", async () => {
      const { asUser, refusals, repositories } = await buildApi({ grants: ["aiTools:view"] });
      const listAdminVisible = vi.spyOn(repositories.ingestionTemplates, "listAdminVisible");

      const view = await asUser("/api/governance/ingestion-templates");
      const admin = await asUser("/api/governance/ingestion-templates/admin");

      expect(view.status).toBe(200);
      expect(admin.status).toBe(403);
      expect(refusals).toEqual(["aiTools:manage"]);
      expect(listAdminVisible).not.toHaveBeenCalled();
    });
  });

  describe("when the two listings are read", () => {
    it("routes the member list and the admin list to different reads", async () => {
      const { asUser, repositories } = await buildApi();
      const seeded = await repositories.ingestionTemplates.createWithAudit({
        template: newTemplateInput({ ottlRules: 'set(attributes["x"], "y")' }),
        callerUserId: "seed",
        surface: "hono",
      });
      const listUserVisible = vi.spyOn(repositories.ingestionTemplates, "listUserVisible");
      const listAdminVisible = vi.spyOn(repositories.ingestionTemplates, "listAdminVisible");

      const member = await asUser("/api/governance/ingestion-templates");
      await expect(member.json()).resolves.toEqual({
        data: [
          {
            id: seeded.id,
            slug: seeded.slug,
            source_type: seeded.sourceType,
            display_name: seeded.displayName,
            description: seeded.description,
            icon_asset: seeded.iconAsset,
            credential_schema: seeded.credentialSchema,
            ottl_rules: "",
            platform_published: false,
            enabled: true,
            organization_id: ORGANIZATION_ID,
          },
        ],
      });

      const admin = await asUser("/api/governance/ingestion-templates/admin");
      const adminBody = (await admin.json()) as { data: { ottl_rules: string }[] };
      expect(adminBody.data[0]?.ottl_rules).toContain('set(attributes["x"]');
      expect(listUserVisible).toHaveBeenCalledOnce();
      expect(listAdminVisible).toHaveBeenCalledOnce();
    });
  });

  describe("when an organization template is created", () => {
    it("answers 201 with the created row and attributes the write to the caller", async () => {
      const { asUser, repositories } = await buildApi();
      const createWithAudit = vi.spyOn(repositories.ingestionTemplates, "createWithAudit");

      const response = await asUser("/api/governance/ingestion-templates", {
        method: "POST",
        body: JSON.stringify({
          source_type: "internal_codex",
          display_name: "Internal Codex",
          description: "Custom",
          ottl_rules: 'set(attributes["langwatch.cost.usd"], attributes["x"])',
        }),
      });

      expect(response.status).toBe(201);
      const body = (await response.json()) as {
        ingestion_template: {
          id: string;
          platform_published: boolean;
          organization_id: string;
        };
      };
      expect(body.ingestion_template).toMatchObject({
        platform_published: false,
        organization_id: ORGANIZATION_ID,
      });
      expect(createWithAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          callerUserId: USER_ID,
          surface: "hono",
          template: expect.objectContaining({
            organizationId: ORGANIZATION_ID,
            sourceType: "internal_codex",
            displayName: "Internal Codex",
          }),
        }),
      );
    });

    it("reads its own name for 'no credential schema' as an absent one", async () => {
      const { asUser, repositories } = await buildApi();
      const createWithAudit = vi.spyOn(repositories.ingestionTemplates, "createWithAudit");

      await asUser("/api/governance/ingestion-templates", {
        method: "POST",
        body: JSON.stringify({
          source_type: "internal_codex",
          display_name: "Internal Codex",
          credential_schema: "otlp_token",
        }),
      });

      expect(createWithAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          template: expect.objectContaining({ credentialSchema: null }),
        }),
      );
    });

    it("names the source type the domain refused, in the family's nested body", async () => {
      const { asUser } = await buildApi();

      const response = await asUser("/api/governance/ingestion-templates", {
        method: "POST",
        body: JSON.stringify({ source_type: "Bad Source!", display_name: "Should Fail" }),
      });

      // 422, the status this framework gives every validation failure — the
      // 400 this family used to answer was the deleted mapper's own choice.
      expect(response.status).toBe(422);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe(new InvalidSourceTypeError().code);
    });

    it("refuses a body with no display name before the application sees it", async () => {
      const { asUser, repositories } = await buildApi();
      const createWithAudit = vi.spyOn(repositories.ingestionTemplates, "createWithAudit");

      const response = await asUser("/api/governance/ingestion-templates", {
        method: "POST",
        body: JSON.stringify({ source_type: "valid_source" }),
      });

      expect(response.status).toBe(422);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("validation_error");
      expect(createWithAudit).not.toHaveBeenCalled();
    });
  });

  describe("when the request declares which surface it came from", () => {
    /**
     * The CLI is the one surface that can name itself over the wire. `trpc` and
     * `mcp` are in-process surfaces, so honouring them from a header would let
     * any caller forge an audit row's provenance.
     */
    it("honours cli and ignores a claim to be an in-process surface", async () => {
      const { asUser, repositories } = await buildApi();
      const createWithAudit = vi.spyOn(repositories.ingestionTemplates, "createWithAudit");

      const create = (surface: string) =>
        asUser("/api/governance/ingestion-templates", {
          method: "POST",
          headers: { "X-LangWatch-Surface": surface },
          body: JSON.stringify({ source_type: "s", display_name: "Named" }),
        });

      await create("cli");
      await create("CLI");
      await create("trpc");
      await create("mcp");

      expect(createWithAudit.mock.calls.map(([input]) => input.surface)).toEqual([
        "cli",
        "cli",
        "hono",
        "hono",
      ]);
    });
  });

  describe("when a template's OTTL is replaced", () => {
    it("answers 200 with the updated row", async () => {
      const { asUser, repositories } = await buildApi();
      const seeded = await repositories.ingestionTemplates.createWithAudit({
        template: newTemplateInput(),
        callerUserId: "seed",
        surface: "hono",
      });
      const updateOttlRulesWithAudit = vi.spyOn(
        repositories.ingestionTemplates,
        "updateOttlRulesWithAudit",
      );

      const response = await asUser(`/api/governance/ingestion-templates/${seeded.id}/ottl-rules`, {
        method: "PATCH",
        body: JSON.stringify({ ottl_rules: 'set(attributes["new"], "1")' }),
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        ingestion_template: { ottl_rules: string };
      };
      expect(body.ingestion_template.ottl_rules).toContain("new");
      expect(updateOttlRulesWithAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORGANIZATION_ID,
          callerUserId: USER_ID,
          id: seeded.id,
          surface: "hono",
        }),
      );
    });

    it("reports a platform-published row as immutable", async () => {
      const { asUser, repositories } = await buildApi();
      const platformTemplate = await repositories.ingestionTemplates.createWithAudit({
        template: newTemplateInput({ organizationId: null }),
        callerUserId: "seed",
        surface: "hono",
      });

      const response = await asUser(
        `/api/governance/ingestion-templates/${platformTemplate.id}/ottl-rules`,
        { method: "PATCH", body: JSON.stringify({ ottl_rules: "forged" }) },
      );

      expect(response.status).toBe(403);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe(new PlatformTemplateImmutableError().code);
    });
  });

  describe("when a template is archived", () => {
    it("answers 200 and reports the row archived", async () => {
      const { asUser, repositories } = await buildApi();
      const seeded = await repositories.ingestionTemplates.createWithAudit({
        template: newTemplateInput(),
        callerUserId: "seed",
        surface: "hono",
      });
      const archiveWithAudit = vi.spyOn(repositories.ingestionTemplates, "archiveWithAudit");

      const response = await asUser(`/api/governance/ingestion-templates/${seeded.id}`, {
        method: "DELETE",
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ archived: true });
      expect(archiveWithAudit).toHaveBeenCalledWith(
        expect.objectContaining({ id: seeded.id, organizationId: ORGANIZATION_ID }),
      );
    });

    it("reports an unknown id as not found", async () => {
      const { asUser } = await buildApi();

      const response = await asUser("/api/governance/ingestion-templates/nope", {
        method: "DELETE",
      });

      expect(response.status).toBe(404);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe(new TemplateNotFoundError("nope").code);
    });
  });

  describe("when a platform template is cloned", () => {
    it("answers 201 with the organization's own copy", async () => {
      const { asUser, repositories } = await buildApi();
      const source = await repositories.ingestionTemplates.createWithAudit({
        template: newTemplateInput({
          organizationId: null,
          displayName: "Clone Source",
          ottlRules: 'set(attributes["from"], "platform")',
        }),
        callerUserId: "seed",
        surface: "hono",
      });

      const response = await asUser("/api/governance/ingestion-templates/clone", {
        method: "POST",
        body: JSON.stringify({ source_template_id: source.id }),
      });

      expect(response.status).toBe(201);
      const body = (await response.json()) as {
        ingestion_template: {
          id: string;
          platform_published: boolean;
          organization_id: string;
          display_name: string;
          ottl_rules: string;
        };
      };
      expect(body.ingestion_template).toMatchObject({
        platform_published: false,
        organization_id: ORGANIZATION_ID,
        display_name: "Clone Source (custom)",
        ottl_rules: 'set(attributes["from"], "platform")',
      });
      expect(body.ingestion_template.id).not.toBe(source.id);
    });

    it("reports an unknown source as not found", async () => {
      const { asUser } = await buildApi();

      const response = await asUser("/api/governance/ingestion-templates/clone", {
        method: "POST",
        body: JSON.stringify({ source_template_id: "gone" }),
      });

      expect(response.status).toBe(404);
    });
  });

  describe("when one template is read by id", () => {
    it("scopes the read to the project's organization", async () => {
      const { asUser, repositories } = await buildApi();
      const seeded = await repositories.ingestionTemplates.createWithAudit({
        template: newTemplateInput(),
        callerUserId: "seed",
        surface: "hono",
      });
      const findVisible = vi.spyOn(repositories.ingestionTemplates, "findVisible");

      const response = await asUser(`/api/governance/ingestion-templates/${seeded.id}`);

      expect(response.status).toBe(200);
      expect(findVisible).toHaveBeenCalledWith({
        id: seeded.id,
        organizationId: ORGANIZATION_ID,
      });
    });

    /**
     * A row belonging to another organization is not "forbidden" — answering that would confirm
     * the id names something real, which is the enumeration vector the scoped read exists to
     * close.
     */
    it("reports a row outside the organization as not found", async () => {
      const { asUser } = await buildApi();

      const response = await asUser("/api/governance/ingestion-templates/foreign");

      expect(response.status).toBe(404);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("template_not_found");
    });

    /**
     * Finding H6 of the 2026-09-04 feature-surface security pass: the response
     * carries the canonical OTTL that the member list blanks and the admin
     * list gates, so reading one row cannot be the cheaper door to it.
     * Spec: specs/security/resource-scope-permission-checks.feature
     */
    /** @scenario Reading one ingestion template demands the same permission as reading them all */
    it("refuses a caller who may only view AI tools, and discloses no rules", async () => {
      const { asUser, refusals, repositories } = await buildApi({ grants: ["aiTools:view"] });
      const seeded = await repositories.ingestionTemplates.createWithAudit({
        template: newTemplateInput(),
        callerUserId: "seed",
        surface: "hono",
      });
      const findVisible = vi.spyOn(repositories.ingestionTemplates, "findVisible");

      const response = await asUser(`/api/governance/ingestion-templates/${seeded.id}`);

      expect(response.status).toBe(403);
      expect(await response.text()).not.toContain(seeded.ottlRules);
      expect(refusals).toEqual(["aiTools:manage"]);
      expect(findVisible).not.toHaveBeenCalled();
    });

    /** @scenario A key with no user behind it cannot read an ingestion template by id */
    it("refuses a legacy project key, which the ceiling alone lets through", async () => {
      const { asProjectKey, repositories } = await buildApi();
      const seeded = await repositories.ingestionTemplates.createWithAudit({
        template: newTemplateInput(),
        callerUserId: "seed",
        surface: "hono",
      });
      const findVisible = vi.spyOn(repositories.ingestionTemplates, "findVisible");

      const response = await asProjectKey(`/api/governance/ingestion-templates/${seeded.id}`);

      expect(response.status).toBe(403);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("user_token_required");
      expect(findVisible).not.toHaveBeenCalled();
    });
  });
});
