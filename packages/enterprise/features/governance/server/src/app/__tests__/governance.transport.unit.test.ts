/**
 * The governance REST door: who may reach each route, what the wire body looks
 * like, and which application operation each verb dispatches to.
 *
 * Ported from
 * `platform/app/src/app/api/governance/__tests__/governance-rest-api.integration.test.ts`,
 * which drove the same family against real Postgres. What that suite proved
 * about the DOOR is here. What it proved about the domain — that the member
 * list suppresses OTTL, that a row outside the organization is not disclosed —
 * belongs to the service that decides it, so what is asserted here is that the
 * door dispatches to the operation which asks that question and renders the
 * answer it gets.
 *
 * The family renders its refusals as a NESTED `{ error: { type, code, message } }`
 * body rather than the flat handled-error envelope. That is deliberate and
 * preserved on the move: the shape is this API's published contract, so
 * changing it would be a wire change.
 *
 * Spec: specs/ai-gateway/governance/governance-api-cli-mcp-coverage.feature
 *       specs/ai-gateway/governance/ingestion-templates-catalog.feature
 */
import { createRestApiService, type RestApiServicePorts } from "@langwatch/api/rest";
import type { AppRestOrganizationVariables, AppRestProjectVariables } from "@langwatch/api/rest";
import type { AuthzService } from "@langwatch/authz-contract";
import {
  InvalidSourceTypeError,
  PlatformTemplateImmutableError,
  TemplateNotFoundError,
  type CreateIngestionTemplateInput,
  type IngestionTemplate,
} from "@langwatch/enterprise-governance-contract";
import { HandledError } from "@langwatch/handled-error";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { ProjectIdentity } from "@langwatch/project-contract";
import type { MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { describe, expect, it, vi } from "vitest";
import { GovernanceApp, type GovernancePersonalVirtualKeyPorts } from "../governance.app";
import { createGovernanceRestApp } from "../../transport/api-rest/governance.api";
import { TestGovernanceService } from "./support/test-governance-service";

/** A dependency this door never reaches; calling one is the test's own bug. */
const unreachable = <Method>(): Method =>
  (() => Promise.reject(new Error("not reachable through the REST door"))) as Method;

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

type RequestOptions = {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
};

function template(overrides: Partial<IngestionTemplate> = {}): IngestionTemplate {
  return {
    id: "tmpl-1",
    slug: "claude_code",
    sourceType: "claude_code",
    displayName: "Platform Default",
    description: "Locked platform row",
    iconAsset: "preset:claude_code",
    credentialSchema: null,
    ottlRules: 'set(attributes["x"], "y")',
    platformPublished: true,
    enabled: true,
    organizationId: null,
    ...overrides,
  };
}

/**
 * The two things the process supplies and this package does not own: who the
 * caller is, and how a refusal is rendered.
 *
 * The authenticator reads the same two headers production reads and resolves
 * ONE of two credential classes — a user-bound key, which sets `apiKeyUserId`,
 * and a legacy project key, which does not. That distinction is the entire
 * subject of the `user_token_required` guard, so it has to be real here rather
 * than assumed.
 *
 * The boundary renders a handled error the way the application's own taxonomy
 * does — the code as the discriminant — because the door hands anything it has
 * not claimed straight to it, and rendering it differently here would assert a
 * body no customer receives.
 */
function spine(grants: readonly string[]) {
  const granted = new Set(grants);
  const refusals: string[] = [];

  const authenticateProject: MiddlewareHandler = async (c, next) => {
    const presented =
      c.req.header("X-Auth-Token") ?? c.req.header("Authorization")?.replace(/^Bearer /, "");
    if (presented !== USER_BOUND_TOKEN && presented !== LEGACY_PROJECT_TOKEN) {
      return c.json({ error: "Unauthorized", message: "Invalid credential" }, 401);
    }
    c.set("project", PROJECT);
    c.set("apiKeyId", "api-key-1");
    if (presented === USER_BOUND_TOKEN) c.set("apiKeyUserId", USER_ID);
    await next();
  };

  const ports: RestApiServicePorts = {
    appContext: async (_c, next) => next(),
    requestLogger: () => async (_c, next) => next(),
    requestTracer: () => async (_c, next) => next(),
    legacyErrorHandler: (error, c) => {
      if (HandledError.isHandled(error)) {
        return c.json(
          { error: error.code, message: error.message },
          (error.httpStatus ?? 500) as ContentfulStatusCode,
        );
      }
      return c.json({ error: "Internal server error" }, 500);
    },
    canonicalErrorHandler: (error, c) => c.json({ error: { message: error.message } }, 500),
    authenticateProject: () => authenticateProject,
    authorizeProjectPermission: () => async (_c, next) => next(),
    authorizeApiKeyCeiling:
      ({ permission }) =>
      async (c, next) => {
        if (!granted.has(permission)) {
          refusals.push(permission);
          return c.json({ error: "Forbidden", message: "Outside the key's ceiling" }, 403);
        }
        await next();
      },
    authenticateOrganization: () => async (_c, next) => next(),
    authorizeOrganizationPermission: () => async (_c, next) => next(),
    authorizeRouteProjectPermission: () => async (_c, next) => next(),
    authenticateOrganizationThrowing: async (_c, next) => next(),
    authorizeOrganizationPermissionThrowing: () => async (_c, next) => next(),
  };

  return {
    refusals,
    security: createRestApiService<AppRestProjectVariables, AppRestOrganizationVariables>(ports),
  };
}

function buildApi(
  options: {
    governance?: Partial<TestGovernanceService>;
    grants?: readonly string[];
  } = {},
) {
  const governance = Object.assign(new TestGovernanceService(), options.governance);
  const getOrganizationId = vi.fn(async () => ORGANIZATION_ID);

  const app = GovernanceApp.create({
    governance,
    projects: { getOrganizationId },
    organizations: {
      ensurePersonalWorkspace: unreachable<OrganizationService["ensurePersonalWorkspace"]>(),
    },
    permissions: { getDecision: unreachable<AuthzService["getDecision"]>() },
    personalVirtualKeys: {
      isOrganizationMember:
        unreachable<GovernancePersonalVirtualKeyPorts["isOrganizationMember"]>(),
      hasActivePersonalKeyLabelled:
        unreachable<GovernancePersonalVirtualKeyPorts["hasActivePersonalKeyLabelled"]>(),
    },
  });

  const built = spine(options.grants ?? ["aiTools:view", "aiTools:manage"]);
  const { hono } = createGovernanceRestApp({ security: built.security, app: () => app });

  const requestWith =
    (token: string, header: string) =>
    (path: string, init: RequestOptions = {}) =>
      hono.request(path, {
        ...(init.method === undefined ? {} : { method: init.method }),
        ...(init.body === undefined ? {} : { body: init.body }),
        headers: {
          [header]: token,
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
      });

  return {
    hono,
    getOrganizationId,
    asUser: requestWith(`Bearer ${USER_BOUND_TOKEN}`, "Authorization"),
    asProjectKey: requestWith(LEGACY_PROJECT_TOKEN, "X-Auth-Token"),
    ...built,
  };
}

describe("createGovernanceRestApp", () => {
  describe("given no credential", () => {
    it("refuses before the request reaches the application", async () => {
      const templateListForUser = vi.fn(async () => []);
      const { hono } = buildApi({ governance: { templateListForUser } });

      const response = await hono.request("/api/governance/ingestion-templates");

      expect(response.status).toBe(401);
      expect(templateListForUser).not.toHaveBeenCalled();
    });

    it("refuses a credential it does not recognise", async () => {
      const { hono } = buildApi();

      const response = await hono.request("/api/governance/ingestion-templates", {
        headers: { "X-Auth-Token": "not-a-real-key" },
      });

      expect(response.status).toBe(401);
    });
  });

  describe("given a legacy project key, which is bound to a project and not to a person", () => {
    it("still serves the member-facing template list", async () => {
      const templateListForUser = vi.fn(async () => [template()]);
      const { asProjectKey } = buildApi({ governance: { templateListForUser } });

      const response = await asProjectKey("/api/governance/ingestion-templates");

      expect(response.status).toBe(200);
      expect(templateListForUser).toHaveBeenCalledWith({ organizationId: ORGANIZATION_ID });
    });

    it("refuses the admin list as user_token_required and reads nothing", async () => {
      const templateListForOrgAdmin = vi.fn(async () => [template()]);
      const { asProjectKey } = buildApi({ governance: { templateListForOrgAdmin } });

      const response = await asProjectKey("/api/governance/ingestion-templates/admin");

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        error: {
          type: "forbidden",
          code: "user_token_required",
          message: expect.any(String),
        },
      });
      expect(templateListForOrgAdmin).not.toHaveBeenCalled();
    });

    it("refuses creating an organization template and writes nothing", async () => {
      const templateCreateOrg = vi.fn(async () => template());
      const { asProjectKey } = buildApi({ governance: { templateCreateOrg } });

      const response = await asProjectKey("/api/governance/ingestion-templates", {
        method: "POST",
        body: JSON.stringify({
          source_type: "internal_codex",
          display_name: "Should Be Forbidden",
        }),
      });

      expect(response.status).toBe(403);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe("user_token_required");
      expect(templateCreateOrg).not.toHaveBeenCalled();
    });
  });

  describe("given a credential whose ceiling does not carry the route's permission", () => {
    it("refuses the manage routes and leaves the view routes reachable", async () => {
      const templateListForUser = vi.fn(async () => []);
      const { asUser, refusals } = buildApi({
        grants: ["aiTools:view"],
        governance: { templateListForUser },
      });

      const view = await asUser("/api/governance/ingestion-templates");
      const admin = await asUser("/api/governance/ingestion-templates/admin");

      expect(view.status).toBe(200);
      expect(admin.status).toBe(403);
      expect(refusals).toEqual(["aiTools:manage"]);
    });
  });

  describe("when the two listings are read", () => {
    it("routes the member list and the admin list to different reads", async () => {
      const templateListForUser = vi.fn(async () => [template({ ottlRules: "" })]);
      const templateListForOrgAdmin = vi.fn(async () => [template()]);
      const { asUser } = buildApi({
        governance: { templateListForUser, templateListForOrgAdmin },
      });

      const member = await asUser("/api/governance/ingestion-templates");
      await expect(member.json()).resolves.toEqual({
        data: [
          {
            id: "tmpl-1",
            slug: "claude_code",
            source_type: "claude_code",
            display_name: "Platform Default",
            description: "Locked platform row",
            icon_asset: "preset:claude_code",
            credential_schema: null,
            ottl_rules: "",
            platform_published: true,
            enabled: true,
            organization_id: null,
          },
        ],
      });

      const admin = await asUser("/api/governance/ingestion-templates/admin");
      const adminBody = (await admin.json()) as { data: Array<{ ottl_rules: string }> };
      expect(adminBody.data[0]?.ottl_rules).toContain('set(attributes["x"]');
      expect(templateListForUser).toHaveBeenCalledOnce();
      expect(templateListForOrgAdmin).toHaveBeenCalledOnce();
    });
  });

  describe("when an organization template is created", () => {
    it("answers 201 with the created row and attributes the write to the caller", async () => {
      const created = template({
        id: "tmpl-new",
        platformPublished: false,
        organizationId: ORGANIZATION_ID,
        displayName: "Internal Codex",
        sourceType: "internal_codex",
      });
      const templateCreateOrg = vi.fn(async () => created);
      const { asUser } = buildApi({ governance: { templateCreateOrg } });

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
        id: "tmpl-new",
        platform_published: false,
        organization_id: ORGANIZATION_ID,
      });
      expect(templateCreateOrg).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORGANIZATION_ID,
          callerUserId: USER_ID,
          sourceType: "internal_codex",
          displayName: "Internal Codex",
          surface: "hono",
        }),
      );
    });

    it("reads its own name for 'no credential schema' as an absent one", async () => {
      const templateCreateOrg = vi.fn(async () => template());
      const { asUser } = buildApi({ governance: { templateCreateOrg } });

      await asUser("/api/governance/ingestion-templates", {
        method: "POST",
        body: JSON.stringify({
          source_type: "internal_codex",
          display_name: "Internal Codex",
          credential_schema: "otlp_token",
        }),
      });

      expect(templateCreateOrg).toHaveBeenCalledWith(
        expect.objectContaining({ credentialSchema: null }),
      );
    });

    it("names the source type the domain refused, in the family's nested body", async () => {
      const templateCreateOrg = vi.fn(async (): Promise<IngestionTemplate> => {
        throw new InvalidSourceTypeError();
      });
      const { asUser } = buildApi({ governance: { templateCreateOrg } });

      const response = await asUser("/api/governance/ingestion-templates", {
        method: "POST",
        body: JSON.stringify({ source_type: "Bad Source!", display_name: "Should Fail" }),
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: { type: string; code: string } };
      expect(body.error).toMatchObject({
        type: "bad_request",
        code: "invalid_source_type",
      });
    });

    it("refuses a body with no display name before the application sees it", async () => {
      const templateCreateOrg = vi.fn(async () => template());
      const { asUser } = buildApi({ governance: { templateCreateOrg } });

      const response = await asUser("/api/governance/ingestion-templates", {
        method: "POST",
        body: JSON.stringify({ source_type: "valid_source" }),
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe("validation_error");
      expect(templateCreateOrg).not.toHaveBeenCalled();
    });
  });

  describe("when the request declares which surface it came from", () => {
    /**
     * The CLI is the one surface that can name itself over the wire. `trpc` and
     * `mcp` are in-process surfaces, so honouring them from a header would let
     * any caller forge an audit row's provenance.
     */
    it("honours cli and ignores a claim to be an in-process surface", async () => {
      const surfaces: Array<CreateIngestionTemplateInput["surface"]> = [];
      const templateCreateOrg = vi.fn(async (input: CreateIngestionTemplateInput) => {
        surfaces.push(input.surface);
        return template();
      });
      const { asUser } = buildApi({ governance: { templateCreateOrg } });

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

      expect(surfaces).toEqual(["cli", "cli", "hono", "hono"]);
    });
  });

  describe("when a template's OTTL is replaced", () => {
    it("answers 200 with the updated row", async () => {
      const updated = template({
        id: "tmpl-2",
        platformPublished: false,
        organizationId: ORGANIZATION_ID,
        ottlRules: 'set(attributes["new"], "1")',
      });
      const templateUpdateOttlRules = vi.fn(async () => updated);
      const { asUser } = buildApi({ governance: { templateUpdateOttlRules } });

      const response = await asUser("/api/governance/ingestion-templates/tmpl-2/ottl-rules", {
        method: "PATCH",
        body: JSON.stringify({ ottl_rules: 'set(attributes["new"], "1")' }),
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        ingestion_template: { ottl_rules: string };
      };
      expect(body.ingestion_template.ottl_rules).toContain("new");
      expect(templateUpdateOttlRules).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORGANIZATION_ID,
          callerUserId: USER_ID,
          id: "tmpl-2",
          surface: "hono",
        }),
      );
    });

    it("reports a platform-published row as immutable", async () => {
      const templateUpdateOttlRules = vi.fn(async (): Promise<IngestionTemplate> => {
        throw new PlatformTemplateImmutableError();
      });
      const { asUser } = buildApi({ governance: { templateUpdateOttlRules } });

      const response = await asUser(
        "/api/governance/ingestion-templates/tmpl-platform/ottl-rules",
        { method: "PATCH", body: JSON.stringify({ ottl_rules: "forged" }) },
      );

      expect(response.status).toBe(403);
      const body = (await response.json()) as { error: { type: string; code: string } };
      expect(body.error).toMatchObject({
        type: "forbidden",
        code: "platform_template_immutable",
      });
    });
  });

  describe("when a template is archived", () => {
    it("answers 200 and reports the row archived", async () => {
      const templateArchiveOrg = vi.fn(async () => undefined);
      const { asUser } = buildApi({ governance: { templateArchiveOrg } });

      const response = await asUser("/api/governance/ingestion-templates/tmpl-3", {
        method: "DELETE",
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ archived: true });
      expect(templateArchiveOrg).toHaveBeenCalledWith(
        expect.objectContaining({ id: "tmpl-3", organizationId: ORGANIZATION_ID }),
      );
    });

    it("reports an unknown id as not found", async () => {
      const templateArchiveOrg = vi.fn(async (): Promise<void> => {
        throw new TemplateNotFoundError("nope");
      });
      const { asUser } = buildApi({ governance: { templateArchiveOrg } });

      const response = await asUser("/api/governance/ingestion-templates/nope", {
        method: "DELETE",
      });

      expect(response.status).toBe(404);
      const body = (await response.json()) as { error: { type: string; code: string } };
      expect(body.error).toMatchObject({
        type: "not_found",
        code: "ingestion_template_not_found",
      });
    });
  });

  describe("when a platform template is cloned", () => {
    it("answers 201 with the organization's own copy", async () => {
      const clone = template({
        id: "tmpl-clone",
        platformPublished: false,
        organizationId: ORGANIZATION_ID,
        displayName: "Clone Source (custom)",
        ottlRules: 'set(attributes["from"], "platform")',
      });
      const templateCloneFromPlatform = vi.fn(async () => clone);
      const { asUser } = buildApi({ governance: { templateCloneFromPlatform } });

      const response = await asUser("/api/governance/ingestion-templates/clone", {
        method: "POST",
        body: JSON.stringify({ source_template_id: "tmpl-platform" }),
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
        id: "tmpl-clone",
        platform_published: false,
        organization_id: ORGANIZATION_ID,
        display_name: "Clone Source (custom)",
        ottl_rules: 'set(attributes["from"], "platform")',
      });
      expect(templateCloneFromPlatform).toHaveBeenCalledWith(
        expect.objectContaining({ sourceTemplateId: "tmpl-platform" }),
      );
    });

    it("reports an unknown source as not found", async () => {
      const templateCloneFromPlatform = vi.fn(async (): Promise<IngestionTemplate> => {
        throw new TemplateNotFoundError("gone");
      });
      const { asUser } = buildApi({ governance: { templateCloneFromPlatform } });

      const response = await asUser("/api/governance/ingestion-templates/clone", {
        method: "POST",
        body: JSON.stringify({ source_template_id: "gone" }),
      });

      expect(response.status).toBe(404);
    });
  });

  describe("when one template is read by id", () => {
    it("scopes the read to the project's organization", async () => {
      const templateGetByIdForOrg = vi.fn(async () => template({ id: "tmpl-4" }));
      const { asUser } = buildApi({ governance: { templateGetByIdForOrg } });

      const response = await asUser("/api/governance/ingestion-templates/tmpl-4");

      expect(response.status).toBe(200);
      expect(templateGetByIdForOrg).toHaveBeenCalledWith({
        id: "tmpl-4",
        organizationId: ORGANIZATION_ID,
      });
    });

    /**
     * A row belonging to another organization is not "forbidden" — answering
     * that would confirm the id names something real, which is the enumeration
     * vector the scoped read exists to close.
     *
     * This one route is the family's exception to the nested body: it runs the
     * read with no try/catch and installs no `onError`, so the handled error
     * reaches the process boundary and is rendered FLAT, as
     * `{ error: "template_not_found" }` — while its own OpenAPI block declares
     * the nested `{ error: { type, code, message } }` for 404. The status is
     * what the old suite pinned and the status is what is pinned here; the
     * body is asserted as it actually is rather than as documented, so the
     * disagreement is visible instead of assumed away.
     */
    it("reports a row outside the organization as not found", async () => {
      const templateGetByIdForOrg = vi.fn(async (): Promise<IngestionTemplate> => {
        throw new TemplateNotFoundError("foreign");
      });
      const { asUser } = buildApi({ governance: { templateGetByIdForOrg } });

      const response = await asUser("/api/governance/ingestion-templates/foreign");

      expect(response.status).toBe(404);
      const body = (await response.json()) as { error: string };
      expect(body.error).toBe("template_not_found");
    });
  });
});
