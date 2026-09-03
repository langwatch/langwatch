// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The governance plane as the CLI reaches it: thirteen routes under
 * `/api/auth/cli` that authenticate with a device-session bearer token and
 * dispatch into Enterprise governance.
 *
 *   GET  /budget/status                          pre-flight before exec'ing a tool
 *   GET  /bootstrap                              the login-completion ceremony
 *   GET  /budget-overview                        every budget binding the caller
 *   GET  /personal-project                       the personal workspace's key
 *   POST /virtual-key                            issue the caller's personal key
 *   POST /project-key                            a named project's existing key
 *   GET  /governance/ingest/sources              the Activity Monitor's sources
 *   GET  /governance/ingest/sources/:id/events   one source's recent events
 *   GET  /governance/ingest/sources/:id/health   one source's health
 *   GET  /governance/status                      the setup state
 *   GET  /governance/ingestion-templates         the org's ingestion templates
 *   POST /governance/ingestion-key               mint a write-only OTLP key
 *   GET  /governance/ingestion-keys              the live personal keys
 *
 * ## Why these sit under an auth path
 *
 * They do not authenticate the way the rest of `/api/governance/*` does. The
 * public governance REST is mounted project-scoped and rejects a device token
 * with 401; these thirteen resolve `organizationId` + `userId` from a
 * validated CLI access token and delegate to the SAME services the browser's
 * tRPC procedures call, so the CLI and the console can never see different
 * data. Only the transport differs.
 *
 * ## The three gates, and their order
 *
 * Every route resolves the bearer FIRST (401), then — where the surface is
 * Enterprise-only — the plan (402 with the upgrade URL inline, so the CLI can
 * render an actionable upsell without a follow-up call), then the RBAC
 * permission (403). A bearer only proves organization membership; without the
 * permission check any member could read every source and every event.
 *
 * A route that MINTS or HANDS BACK a credential adds a fourth: current, active
 * membership re-derived from rows, because an access token minted before an
 * offboarding is still cryptographically fine and the keys these routes hand
 * out are the ones the owner ceiling never reaches.
 *
 * ORDERING: this family shares `/api/auth/cli` with the RFC 8628 device grant
 * and must, like it, be registered BEFORE the `/api/auth/*` catch-all.
 */
import { handlerManagedAuth } from "@langwatch/api";
import type { AppRestSecurity, MountableRestApp } from "@langwatch/api/rest";
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import { assertEnterprisePlan, ENTERPRISE_FEATURE_ERRORS } from "@langwatch/enterprise-plan-gate";
import {
  NoEligibleProvidersError,
  PersonalVirtualKeyAlreadyExistsError,
  PersonalWorkspaceMissingError,
  PLATFORM_TOOL_SLUG_BY_SOURCE_TYPE,
  RoutingPolicyHasNoProvidersError,
  type GovernanceService,
} from "@langwatch/enterprise-governance-contract";
import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { randomBytes } from "node:crypto";
import type { Context } from "hono";
import { z } from "zod";

import { resolveSupportContact } from "../../services/organization-support-contact.service";

const logger = createLogger("langwatch:governance-cli");

const CLI_REASON = "CLI device-session bearer validated in-handler";

/** The identity a validated CLI access token carries. */
export type GovernanceCliCaller = Readonly<{
  user_id: string;
  organization_id: string;
  client_info?:
    | Readonly<{ device_label?: string | undefined; hostname?: string | undefined }>
    | undefined;
}>;

/**
 * The device session behind a request, as this process reads it.
 *
 * Declared structurally rather than imported from the package that WRITES the
 * token records: the two halves of `/api/auth/cli` are owned by two features
 * on purpose, and the reader is the only thing this half needs. The
 * composition root binds it to the one implementation, so there is still
 * exactly one place the keyspace is spelled.
 */
export type GovernanceCliAccessTokenPort = Readonly<{
  /** The caller behind an `Authorization` header, or nothing. */
  resolve: (authHeader: string | null | undefined) => Promise<GovernanceCliCaller | null>;
  /**
   * Severs the presented token, so an offboarded caller's pre-removal session
   * stops authenticating the moment it is refused rather than at its next
   * hourly expiry.
   */
  revoke: (input: { authHeader: string | null | undefined; userId: string }) => Promise<void>;
}>;

/** The personal workspace the credential routes resolve a project through. */
export type GovernanceCliPersonalWorkspace = Readonly<{
  team: Readonly<{ id: string }>;
  project: Readonly<{ id: string; slug: string; name: string; apiKey: string }>;
}>;

/**
 * The budget evaluation the pre-flight check runs, or none.
 *
 * The SAME decision the gateway makes at request time, asked with a projected
 * cost of zero so nothing is committed. Absent on a deployment with no spend
 * store: the pre-flight then answers `{ok: true}` and the gateway surfaces the
 * real block on the first request through the same code path — which is the
 * documented degradation for installs that run no ClickHouse, not a new one.
 */
export type GovernanceCliBudgetPort = Readonly<{
  check: (input: {
    organizationId: string;
    teamId: string;
    projectId: string;
    virtualKeyId: string;
    principalUserId: string;
    projectedCostUsd: number;
  }) => Promise<
    Readonly<{
      decision: string;
      blockedBy: ReadonlyArray<{
        scope: string;
        scopeId: string;
        limitUsd: string;
        spentUsd: string;
        window: string;
      }>;
    }>
  >;
}>;

/** Everything the CLI governance plane reaches that governance does not own. */
export type GovernanceCliRestPorts = Readonly<{
  /** The device session a bearer names, and how to sever it. */
  accessTokens: GovernanceCliAccessTokenPort;
  /** The SAME governance service the console's tRPC procedures read. */
  governance: () => GovernanceService;
  /** The typed client the identity, membership and project reads run on. */
  database: () => PrismaClient;
  /** Resolves — creating if needed — the caller's personal workspace. */
  ensurePersonalWorkspace: (input: {
    organizationId: string;
    userId: string;
    displayName?: string | null;
    displayEmail?: string | null;
  }) => Promise<GovernanceCliPersonalWorkspace>;
  /** The caller's personal workspace where one already exists, or nothing. */
  tryFindPersonalWorkspace: (input: {
    organizationId: string;
    userId: string;
  }) => Promise<GovernanceCliPersonalWorkspace | null>;
  /** Which plan an organization is on, for the Enterprise gate. */
  plans: () => PlanProvider;
  /**
   * The RBAC decisions this family gates on.
   *
   * ORGANIZATION-tier for the governance reads, PROJECT-tier for the two
   * credential handouts — the deployment's own AuthZ graph in both cases,
   * which is why they arrive rather than being resolved here.
   */
  permittedOnOrganization: (input: {
    userId: string;
    organizationId: string;
    permission: AuthzPermission;
  }) => Promise<boolean>;
  permittedOnProject: (input: {
    userId: string;
    projectId: string;
    permission: AuthzPermission;
  }) => Promise<boolean>;
  /** The spend decision the budget pre-flight asks, where one is composed. */
  budgets?: GovernanceCliBudgetPort | undefined;
  /** The deployment's public origin; the upgrade and OTLP links are built from it. */
  publicBaseUrl?: string | undefined;
}>;

const issueVirtualKeySchema = z.object({
  device_label: z.string().optional(),
});

const projectKeyRequestSchema = z.object({
  slug: z.string().min(1),
});

const mintIngestionKeySchema = z.object({
  source_type: z.string().min(1),
  /**
   * Project id or slug, resolved inside the caller's organization only. Omit
   * for the caller's personal project.
   */
  project: z.string().min(1).optional(),
  /**
   * Machine this key is for, shown as provenance on the API-keys page. Capped
   * like every other device label the CLI sends, and sanitized before it
   * reaches the key name.
   */
  device_label: z.string().min(1).max(128).optional(),
});

/**
 * Reduce a free-form device label to the charset a key name carries. Returns
 * null when nothing usable survives, so the caller falls back to a random
 * suffix rather than naming every machine the same.
 */
function sanitizeDeviceLabel(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .slice(0, 24)
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned.length > 0 ? cleaned : null;
}

/** Builds the CLI governance family over one process's ports. */
export function createGovernanceCliRestApp(options: {
  security: AppRestSecurity;
  ports: GovernanceCliRestPorts;
}): MountableRestApp {
  const { security, ports } = options;
  const secured = security.createServiceApp({ basePath: "/api/auth/cli" });

  // The bearer authenticates the caller and gates on no RBAC permission.
  const cliPolicy = handlerManagedAuth({
    reason: CLI_REASON,
    permissions: [],
    credential: "session",
  });
  // Routes that DO check a permission once the caller is resolved declare it,
  // rather than hiding behind the base policy's empty list.
  const cliIngestionSourcesAuth = handlerManagedAuth({
    reason: CLI_REASON,
    permissions: ["ingestionSources:view"],
    credential: "session",
  });
  const cliActivityMonitorAuth = handlerManagedAuth({
    reason: CLI_REASON,
    permissions: ["activityMonitor:view"],
    credential: "session",
  });

  const baseUrl = (): string =>
    (ports.publicBaseUrl ?? "http://localhost:5560").replace(/\/+$/, "");

  /** The control-plane origin the CLI persists, and the OTLP endpoint's root. */
  const controlPlaneBaseUrl = (): string =>
    (ports.publicBaseUrl ?? "https://app.langwatch.ai").replace(/\/+$/, "");

  const unauthorized = (c: Context) =>
    c.json(
      {
        error: "unauthorized",
        error_description: "Bearer access token is missing, malformed, or expired",
      },
      401,
    );

  /**
   * The Enterprise gate, as REST rather than as a tRPC refusal.
   *
   * 402 with the upgrade URL inline (RFC 7231 §6.5.2), so the CLI renders an
   * actionable upsell without a second call. Fail-closed: a lookup that throws
   * refuses, because "we could not tell" is not "you are entitled".
   */
  const refuseWithoutEnterprise = async (
    c: Context,
    organizationId: string,
    errorMessage: string,
  ): Promise<Response | null> => {
    try {
      await assertEnterprisePlan({
        planProvider: ports.plans(),
        organizationId,
        errorMessage,
      });
      return null;
    } catch {
      return c.json(
        {
          error: "payment_required",
          error_description: errorMessage,
          upgrade_url: `${baseUrl()}/settings/subscription`,
        },
        402,
      );
    }
  };

  /**
   * The governance RBAC check the browser surfaces make, for the same caller.
   *
   * The bearer only proves organization membership, so without this any member
   * could read every source, every event and the whole setup state.
   */
  const refuseWithoutPermission = async (
    c: Context,
    caller: GovernanceCliCaller,
    permission: AuthzPermission,
  ): Promise<Response | null> => {
    const allowed = await ports.permittedOnOrganization({
      userId: caller.user_id,
      organizationId: caller.organization_id,
      permission,
    });
    if (allowed) return null;
    return c.json(
      {
        error: "forbidden",
        error_description: `Missing required permission '${permission}' on this organization`,
      },
      403,
    );
  };

  /**
   * The tenancy boundary for key-minting routes.
   *
   * Resolving a token only proves it has not expired; it says nothing about
   * whether the person is STILL an active member of the token's organization.
   * A user offboarded after their token was issued must not be able to
   * recreate a personal workspace in the former tenant or pull any project's
   * key, so every route that mints or returns a key re-derives current
   * membership from rows — the same authority the console's RBAC reads.
   *
   * On refusal it also severs the presented token, org-scoped: only this
   * session dies, never the same person's sessions in other organizations.
   */
  const refuseInactiveMember = async (
    c: Context,
    caller: GovernanceCliCaller,
  ): Promise<Response | null> => {
    const prisma = ports.database();
    const [user, membership] = await Promise.all([
      prisma.user.findUnique({
        where: { id: caller.user_id },
        select: { deactivatedAt: true },
      }),
      // `disabledAt` is part of the predicate: a seat an admin disabled to
      // reclaim it is not an active membership, and the keys minted here are
      // the ones the owner ceiling never reaches — a project key has no owner,
      // and the gateway honours a personal virtual key on its own status.
      prisma.organizationUser.findFirst({
        where: {
          userId: caller.user_id,
          organizationId: caller.organization_id,
          disabledAt: null,
        },
        select: { userId: true },
      }),
    ]);

    if (!!user && user.deactivatedAt === null && !!membership) return null;

    try {
      await ports.accessTokens.revoke({
        authHeader: c.req.header("Authorization"),
        userId: caller.user_id,
      });
    } catch (err) {
      logger.warn(
        { err, userId: caller.user_id },
        "[governance-cli] failed to revoke stale access token on membership refusal",
      );
    }

    logger.info(
      {
        userId: caller.user_id,
        organizationId: caller.organization_id,
        reason: !user
          ? "user_missing"
          : user.deactivatedAt !== null
            ? "user_deactivated"
            : "not_org_member",
      },
      "[governance-cli] refusing key-minting request from non-active org member; session revoked",
    );

    return c.json(
      {
        error: "forbidden",
        error_description:
          "Your access to this organization has ended. Run `langwatch login` to sign in again.",
      },
      403,
    );
  };

  /**
   * The authorization rule every route that hands back a project's key shares:
   * a personal project is honoured only as the caller's OWN explicit pick, and
   * because the key is the shared write credential usable outside the console's
   * RBAC constraints, membership alone is not enough — the caller needs a
   * write-capable project permission. A view-only member cannot extract it.
   */
  const refuseProjectKeyHandout = async (
    c: Context,
    project: { id: string; isPersonal: boolean; ownerUserId: string | null },
    userId: string,
  ): Promise<Response | null> => {
    if (project.isPersonal && project.ownerUserId !== userId) {
      return c.json(
        {
          error: "personal_project_not_allowed",
          error_description:
            "Another user's personal project can't back your API key. Pick a shared team project, or your own personal workspace.",
        },
        400,
      );
    }
    const canWriteProject = await ports.permittedOnProject({
      userId,
      projectId: project.id,
      permission: "project:update",
    });
    if (!canWriteProject) {
      return c.json(
        {
          error: "forbidden",
          error_description: "You need write access to this project to retrieve its API key.",
        },
        403,
      );
    }
    return null;
  };

  // ---------- GET /api/auth/cli/budget/status ----------
  // Pre-flight called by `langwatch claude` / `codex` / `cursor` / `gemini`
  // before exec'ing the underlying tool, so the wrapper can render the
  // budget-exceeded box without making any real model calls.
  secured.access(cliPolicy).get("/budget/status", async (c) => {
    const caller = await ports.accessTokens.resolve(c.req.header("Authorization"));
    if (!caller) return unauthorized(c);

    // No personal workspace yet (first login, CLI never activated) means
    // nothing can be over budget: answer 200 and let the wrapper exec.
    const workspace = await ports.tryFindPersonalWorkspace({
      organizationId: caller.organization_id,
      userId: caller.user_id,
    });
    if (!workspace) return c.json({ ok: true }, 200);

    // Same graceful fallback for the virtual key: no key means no traffic
    // flowing, so nothing to block on.
    const keys = await ports.governance().personalVirtualKeyList({
      userId: caller.user_id,
      organizationId: caller.organization_id,
    });
    const personalVk = keys[0];
    if (!personalVk) return c.json({ ok: true }, 200);

    const budgets = ports.budgets;
    if (!budgets) return c.json({ ok: true }, 200);

    const decision = await budgets.check({
      organizationId: caller.organization_id,
      teamId: workspace.team.id,
      projectId: workspace.project.id,
      virtualKeyId: personalVk.id,
      principalUserId: caller.user_id,
      projectedCostUsd: 0,
    });

    if (decision.decision !== "hard_block" || decision.blockedBy.length === 0) {
      return c.json({ ok: true }, 200);
    }

    // The most restrictive blocker. The check result orders by strictness, so
    // the first entry is the binding one.
    const blocker = decision.blockedBy[0]!;
    const adminEmail = await resolveSupportContact({
      prisma: ports.database(),
      organizationId: caller.organization_id,
    });
    const params = new URLSearchParams({
      scope: blocker.scope.toLowerCase(),
      scope_id: blocker.scopeId,
      limit_usd: blocker.limitUsd,
      spent_usd: blocker.spentUsd,
    });

    return c.json(
      {
        error: {
          type: "budget_exceeded",
          scope: blocker.scope.toLowerCase(),
          limit_usd: blocker.limitUsd,
          spent_usd: blocker.spentUsd,
          period: blocker.window.toLowerCase(),
          request_increase_url: `${baseUrl()}/me/budget/request?${params.toString()}`,
          admin_email: adminEmail,
        },
      },
      402,
    );
  });

  // ---------- GET /api/auth/cli/bootstrap ----------
  // The login-completion ceremony: inherited providers plus the monthly
  // budget. The wire shape matches the tRPC `user.cliBootstrap` procedure
  // byte for byte — both read one service — so the SDK renders identically
  // whichever path it took.
  secured.access(cliPolicy).get("/bootstrap", async (c) => {
    const caller = await ports.accessTokens.resolve(c.req.header("Authorization"));
    if (!caller) return unauthorized(c);
    const result = await ports.governance().cliBootstrapResolve({
      userId: caller.user_id,
      organizationId: caller.organization_id,
    });
    return c.json(result, 200);
  });

  // ---------- GET /api/auth/cli/budget-overview ----------
  // Every budget that binds the caller's own keys, labelled per scope, for the
  // `langwatch login` epilogue. Matches the tRPC `user.budgetOverview`
  // procedure byte for byte, replacing the single collapsed number the
  // bootstrap `budget` field carries for older CLIs.
  secured.access(cliPolicy).get("/budget-overview", async (c) => {
    const caller = await ports.accessTokens.resolve(c.req.header("Authorization"));
    if (!caller) return unauthorized(c);
    const result = await ports.governance().personalBudgetOverviewForUser({
      userId: caller.user_id,
      organizationId: caller.organization_id,
    });
    return c.json(result, 200);
  });

  // ---------- GET /api/auth/cli/personal-project ----------
  // Lazy personal-key exchange for device sessions minted before the exchange
  // started shipping the personal project. The CLI calls it once, persists the
  // key, and never asks again.
  secured.access(cliPolicy).get("/personal-project", async (c) => {
    const caller = await ports.accessTokens.resolve(c.req.header("Authorization"));
    if (!caller) return unauthorized(c);
    // Tenancy boundary BEFORE the ensure, which would otherwise recreate a
    // personal workspace in a former tenant and hand its key to an offboarded
    // person.
    const denied = await refuseInactiveMember(c, caller);
    if (denied) return denied;

    const user = await ports.database().user.findUnique({
      where: { id: caller.user_id },
      select: { name: true, email: true },
    });
    try {
      const workspace = await ports.ensurePersonalWorkspace({
        organizationId: caller.organization_id,
        userId: caller.user_id,
        displayName: user?.name,
        displayEmail: user?.email,
      });
      return c.json(
        {
          project: {
            id: workspace.project.id,
            slug: workspace.project.slug,
            name: workspace.project.name,
            api_key: workspace.project.apiKey,
          },
        },
        200,
      );
    } catch (err) {
      logger.error(
        { err, userId: caller.user_id },
        "[governance-cli] personal-project resolution failed",
      );
      return c.json(
        {
          error: "server_error",
          error_description: "Could not resolve your personal project",
        },
        500,
      );
    }
  });

  // ---------- POST /api/auth/cli/virtual-key ----------
  // Issues the caller's personal virtual key on demand. This is the only way
  // the CLI obtains one: it asks the first time a tool resolves to gateway
  // mode, so a login that never routes a model call leaves no key behind, and
  // a re-login on a machine that already holds one adds nothing.
  secured.access(cliPolicy).post("/virtual-key", async (c) => {
    const caller = await ports.accessTokens.resolve(c.req.header("Authorization"));
    if (!caller) return unauthorized(c);
    // Same tenancy boundary as `/personal-project`: this mints a credential.
    const denied = await refuseInactiveMember(c, caller);
    if (denied) return denied;

    const body = await c.req.json().catch(() => ({}));
    const parsed = issueVirtualKeySchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "invalid_request", error_description: "device_label must be a string" },
        400,
      );
    }

    const user = await ports.database().user.findUnique({
      where: { id: caller.user_id },
      select: { name: true, email: true },
    });

    try {
      const issued = await issuePersonalVirtualKey({
        governance: ports.governance(),
        ensurePersonalWorkspace: ports.ensurePersonalWorkspace,
        userId: caller.user_id,
        organizationId: caller.organization_id,
        displayName: user?.name,
        displayEmail: user?.email,
        deviceLabel: sanitizeDeviceLabel(parsed.data.device_label),
      });
      return c.json(
        {
          id: issued.virtualKey.id,
          secret: issued.secret,
          prefix: issued.virtualKey.displayPrefix,
        },
        201,
      );
    } catch (err) {
      // Both empty-provider causes collapse into one 409: whether the
      // organization has no provider at all or pinned a policy holding none,
      // the person's next step is the same, and a key minted anyway would fail
      // on its first request.
      if (
        err instanceof NoEligibleProvidersError ||
        err instanceof RoutingPolicyHasNoProvidersError
      ) {
        logger.info(
          {
            userId: caller.user_id,
            organizationId: caller.organization_id,
            reason:
              err instanceof NoEligibleProvidersError
                ? "no_eligible_providers"
                : "routing_policy_has_no_providers",
          },
          "[governance-cli] refusing personal virtual key: no provider to route to",
        );
        return c.json(
          {
            error: "no_eligible_providers",
            error_description:
              "Your organization has no AI providers configured for the gateway. Ask an admin to add one at Settings → Model Providers.",
          },
          409,
        );
      }
      logger.error(
        { err, userId: caller.user_id },
        "[governance-cli] personal virtual key issuance failed",
      );
      return c.json(
        { error: "server_error", error_description: "Could not issue a personal virtual key" },
        500,
      );
    }
  });

  // ---------- POST /api/auth/cli/project-key ----------
  // Non-interactive project login: `langwatch login --project <slug>` in a
  // headless context. The device session proves the person, the same RBAC gate
  // as the browser approval applies, and nothing new is minted — the project's
  // existing key is returned. The caller's OWN personal project is allowed,
  // exactly like an explicit pick on the authorize page; anyone else's is
  // refused.
  secured.access(cliPolicy).post("/project-key", async (c) => {
    const caller = await ports.accessTokens.resolve(c.req.header("Authorization"));
    if (!caller) return unauthorized(c);
    const denied = await refuseInactiveMember(c, caller);
    if (denied) return denied;

    const body = await c.req.json().catch(() => ({}));
    const parsed = projectKeyRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", error_description: "slug is required" }, 400);
    }
    const project = await ports.database().project.findFirst({
      where: {
        slug: parsed.data.slug,
        archivedAt: null,
        team: { organizationId: caller.organization_id },
      },
      select: {
        id: true,
        slug: true,
        name: true,
        apiKey: true,
        isPersonal: true,
        ownerUserId: true,
      },
    });
    if (!project) {
      return c.json(
        {
          error: "not_found",
          error_description: `No project with slug "${parsed.data.slug}" in your organization`,
        },
        404,
      );
    }
    const refusal = await refuseProjectKeyHandout(c, project, caller.user_id);
    if (refusal) return refusal;
    return c.json(
      {
        api_key: project.apiKey,
        project: { id: project.id, slug: project.slug, name: project.name },
      },
      200,
    );
  });

  // ---------- GET /api/auth/cli/governance/ingest/sources ----------
  secured.access(cliIngestionSourcesAuth).get("/governance/ingest/sources", async (c) => {
    const caller = await ports.accessTokens.resolve(c.req.header("Authorization"));
    if (!caller) return unauthorized(c);
    const gate = await refuseWithoutEnterprise(
      c,
      caller.organization_id,
      ENTERPRISE_FEATURE_ERRORS.INGESTION_SOURCES,
    );
    if (gate) return gate;
    const denied = await refuseWithoutPermission(c, caller, "ingestionSources:view");
    if (denied) return denied;

    const includeArchived = c.req.query("include_archived") === "1";
    const sources = await ports.governance().ingestionSourceList(caller.organization_id);
    const filtered = includeArchived
      ? sources
      : sources.filter((source) => source.archivedAt === null);
    return c.json({
      sources: filtered.map((source) => ({
        id: source.id,
        name: source.name,
        sourceType: source.sourceType,
        description: source.description,
        status: source.status,
        lastEventAt: source.lastEventAt?.toISOString() ?? null,
        createdAt: source.createdAt.toISOString(),
        archivedAt: source.archivedAt?.toISOString() ?? null,
      })),
    });
  });

  // ---------- GET /api/auth/cli/governance/ingest/sources/:id/events ----------
  secured.access(cliActivityMonitorAuth).get("/governance/ingest/sources/:id/events", async (c) => {
    const caller = await ports.accessTokens.resolve(c.req.header("Authorization"));
    if (!caller) return unauthorized(c);
    const gate = await refuseWithoutEnterprise(
      c,
      caller.organization_id,
      ENTERPRISE_FEATURE_ERRORS.ACTIVITY_MONITOR,
    );
    if (gate) return gate;
    const denied = await refuseWithoutPermission(c, caller, "activityMonitor:view");
    if (denied) return denied;

    const sourceId = c.req.param("id");
    if (!sourceId) {
      return c.json({ error: "invalid_request", error_description: "source id is required" }, 400);
    }
    const limitRaw = c.req.query("limit");
    const beforeIso = c.req.query("before_iso") ?? undefined;
    const limit = limitRaw ? Math.min(Math.max(1, parseInt(limitRaw, 10)), 200) : 50;

    // Ownership is proved before the analytics read, so a valid bearer
    // cannot walk source ids belonging to another tenant even though the
    // read below also filters by organization.
    await ports.governance().ingestionSourceGetById({
      id: sourceId,
      organizationId: caller.organization_id,
    });

    const events = await ports.governance().activityEventsForSource({
      organizationId: caller.organization_id,
      sourceId,
      limit,
      beforeIso,
    });
    return c.json({ events });
  });

  // ---------- GET /api/auth/cli/governance/ingest/sources/:id/health ----------
  secured.access(cliActivityMonitorAuth).get("/governance/ingest/sources/:id/health", async (c) => {
    const caller = await ports.accessTokens.resolve(c.req.header("Authorization"));
    if (!caller) return unauthorized(c);
    const gate = await refuseWithoutEnterprise(
      c,
      caller.organization_id,
      ENTERPRISE_FEATURE_ERRORS.INGESTION_SOURCES,
    );
    if (gate) return gate;
    const denied = await refuseWithoutPermission(c, caller, "activityMonitor:view");
    if (denied) return denied;

    const sourceId = c.req.param("id");
    if (!sourceId) {
      return c.json({ error: "invalid_request", error_description: "source id is required" }, 400);
    }
    const source = await ports.governance().ingestionSourceGetById({
      id: sourceId,
      organizationId: caller.organization_id,
    });
    const health = await ports.governance().activitySourceHealthMetrics({
      organizationId: caller.organization_id,
      sourceId,
    });
    return c.json({
      source: { id: source.id, name: source.name, status: source.status },
      health,
    });
  });

  // ---------- GET /api/auth/cli/governance/status ----------
  secured.access(cliPolicy).get("/governance/status", async (c) => {
    const caller = await ports.accessTokens.resolve(c.req.header("Authorization"));
    if (!caller) return unauthorized(c);
    const gate = await refuseWithoutEnterprise(
      c,
      caller.organization_id,
      ENTERPRISE_FEATURE_ERRORS.INGESTION_SOURCES,
    );
    if (gate) return gate;
    const setup = await ports.governance().resolveSetupState(caller.organization_id);
    return c.json({ setup });
  });

  // ---------- GET /api/auth/cli/governance/ingestion-templates ----------
  // The wrapper reads these from a device-session context. The project-scoped
  // public REST at `/api/governance/ingestion-templates` rejects a device
  // token with 401; this adapter resolves the organization from the validated
  // bearer and delegates to the same service. The snake_case envelope is what
  // the CLI expects, distinct from the project-key REST's `{ data: [...] }`.
  secured.access(cliPolicy).get("/governance/ingestion-templates", async (c) => {
    const caller = await ports.accessTokens.resolve(c.req.header("Authorization"));
    if (!caller) return unauthorized(c);
    const rows = await ports.governance().templateListForUser({
      organizationId: caller.organization_id,
    });
    return c.json({
      ingestion_templates: rows.map((template) => ({
        id: template.id,
        organization_id: template.organizationId,
        slug: template.slug,
        source_type: template.sourceType,
        display_name: template.displayName,
        description: template.description,
        icon_asset: template.iconAsset,
        credential_schema: template.credentialSchema,
        ottl_rules: template.ottlRules,
        platform_published: template.platformPublished,
        enabled: template.enabled,
      })),
    });
  });

  // ---------- POST /api/auth/cli/governance/ingestion-key ----------
  // Mints a write-only `ik-lw-` key and OTLP endpoint for the device-session
  // caller. `source_type` is stored as `langwatch.source` provenance.
  //
  // Without `project`, rotate the key for the caller's personal project. With
  // an authorised project id or slug, create a key for that project instead so
  // separate machines can retain their own key. Both return `/api/otel`.
  secured.access(cliPolicy).post("/governance/ingestion-key", async (c) => {
    const caller = await ports.accessTokens.resolve(c.req.header("Authorization"));
    if (!caller) return unauthorized(c);
    // This mints a credential, so an offboarded caller's pre-removal token
    // must not reach it — the same boundary `/virtual-key` holds.
    const denied = await refuseInactiveMember(c, caller);
    if (denied) return denied;

    const parsed = mintIngestionKeySchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "invalid_request", error_description: parsed.error.message }, 400);
    }

    // Apply the declared tool's direct-OTLP policy: a mint naming a tool the
    // organization turned off is refused, which catches an old CLI, a stale
    // cached policy, or a hand-run of the documented flow. The declaration is
    // trusted; the issued key still carries only the caller's existing
    // `traces:create` grant, so this is a policy backstop rather than a tenant
    // boundary. Only source types a wrapped tool stamps are governed; anything
    // else has no per-tool policy to apply and must stay mintable.
    //
    // `Object.hasOwn` rather than a plain lookup: the key is request-
    // controlled, so `"toString"` would otherwise resolve an inherited
    // function, pass a truthy check, and index the policy map with nothing.
    const policedSlug = Object.hasOwn(PLATFORM_TOOL_SLUG_BY_SOURCE_TYPE, parsed.data.source_type)
      ? PLATFORM_TOOL_SLUG_BY_SOURCE_TYPE[parsed.data.source_type]
      : undefined;
    if (policedSlug) {
      const policy = await ports.governance().aiToolResolvePolicy({
        organizationId: caller.organization_id,
        userId: caller.user_id,
        slug: policedSlug,
      });
      if (!policy.allowOtelDirect) {
        return c.json(
          {
            error: "direct_otel_not_allowed",
            error_description: `Your organization does not allow ${policedSlug} to send telemetry directly. Run \`langwatch ${policedSlug}\`, which routes through the gateway.`,
          },
          403,
        );
      }
    }

    if (parsed.data.project) {
      return await mintProjectIngestionKey(c, {
        caller,
        projectRef: parsed.data.project,
        sourceType: parsed.data.source_type,
        deviceLabel: parsed.data.device_label ?? null,
      });
    }

    return await mintPersonalIngestionKey(c, {
      caller,
      sourceType: parsed.data.source_type,
    });
  });

  /**
   * The named-project branch of the ingestion-key mint.
   *
   * `projectRef` is read as an id first, then as a slug, and both lookups stay
   * inside the caller's organization: a project in another tenant reports the
   * same `project_not_found` as one that does not exist, so the answer never
   * says which ids are real elsewhere. Membership alone does not authorize the
   * mint — the caller needs `traces:create` on the project itself, which is
   * exactly the permission the minted key carries.
   */
  async function mintProjectIngestionKey(
    c: Context,
    input: {
      caller: GovernanceCliCaller;
      projectRef: string;
      sourceType: string;
      deviceLabel: string | null;
    },
  ): Promise<Response> {
    const prisma = ports.database();
    const select = {
      id: true,
      slug: true,
      name: true,
      isPersonal: true,
      ownerUserId: true,
    } as const;
    const inOrg = {
      archivedAt: null,
      team: { organizationId: input.caller.organization_id },
    };
    const project =
      (await prisma.project.findFirst({ where: { id: input.projectRef, ...inOrg }, select })) ??
      (await prisma.project.findFirst({ where: { slug: input.projectRef, ...inOrg }, select }));
    if (!project) {
      return c.json(
        {
          error: "project_not_found",
          error_description: `No project "${input.projectRef}" in your organization`,
        },
        404,
      );
    }

    // Another person's personal workspace is theirs alone; no permission grant
    // can make a second principal's key into it legitimate.
    if (project.isPersonal && project.ownerUserId !== input.caller.user_id) {
      return c.json(
        {
          error: "personal_project_not_allowed",
          error_description:
            "Another user's personal project can't receive your ingestion key. Pick a shared team project, or your own personal workspace.",
        },
        400,
      );
    }

    const allowed = await ports.permittedOnProject({
      userId: input.caller.user_id,
      projectId: project.id,
      permission: "traces:create",
    });
    if (!allowed) {
      return c.json(
        {
          error: "forbidden",
          error_description:
            "You need permission to write traces into this project to mint an ingestion key for it.",
        },
        403,
      );
    }

    try {
      const result = await ports.governance().ingestionKeyIssueForProject({
        callerUserId: input.caller.user_id,
        // A shared project's key is an org service key, owned by nobody, so it
        // stays visible to the whole team. The caller's own personal workspace
        // is the exception: only its owner may hold a key that reaches it.
        ownerUserId: project.isPersonal ? input.caller.user_id : null,
        organizationId: input.caller.organization_id,
        projectId: project.id,
        sourceType: input.sourceType,
        // The label lands inside the key's display name, so it goes through
        // the same reduction a virtual-key label does rather than reaching the
        // name as free-form text.
        createdByDeviceLabel: sanitizeDeviceLabel(
          input.deviceLabel ??
            input.caller.client_info?.device_label ??
            input.caller.client_info?.hostname ??
            undefined,
        ),
      });
      return c.json(
        {
          token: result.token,
          prefix: result.prefix,
          endpoint: `${controlPlaneBaseUrl()}/api/otel`,
          project: { id: project.id, slug: project.slug, name: project.name },
        },
        201,
      );
    } catch (err) {
      logger.error(
        { err, projectId: project.id, sourceType: input.sourceType },
        "[governance-cli] project ingestion-key mint failed",
      );
      return c.json(
        {
          error: "server_error",
          error_description: "Could not mint an ingestion key for this project",
        },
        500,
      );
    }
  }

  /**
   * The personal-project branch of the ingestion-key mint: the caller's own
   * workspace, rotating in place so one person never accumulates keys for one
   * tool.
   */
  async function mintPersonalIngestionKey(
    c: Context,
    input: { caller: GovernanceCliCaller; sourceType: string },
  ): Promise<Response> {
    try {
      const result = await ports.governance().ingestionKeyEnsureForPersonalProject({
        userId: input.caller.user_id,
        organizationId: input.caller.organization_id,
        sourceType: input.sourceType,
        // Snapshot which device minted the key so the API-keys settings page
        // can attribute it. Falls back to the hostname when the CLI sent no
        // explicit label; null for CLIs that predate device metadata.
        createdByDeviceLabel:
          input.caller.client_info?.device_label ?? input.caller.client_info?.hostname ?? null,
      });
      return c.json(
        {
          token: result.token,
          prefix: result.prefix,
          endpoint: `${controlPlaneBaseUrl()}/api/otel`,
        },
        201,
      );
    } catch (err) {
      // Only the missing workspace is a precondition the caller can fix, so it
      // is the only failure that reports as one. Everything else is a server
      // fault: logged, with a fixed message, rather than a prompt the person
      // cannot act on and an internal error string on the wire.
      if (err instanceof PersonalWorkspaceMissingError) {
        return c.json(
          {
            error: "precondition_failed",
            error_description: "Sign in to a personal workspace before issuing an ingestion key.",
          },
          412,
        );
      }
      logger.error(
        { err, userId: input.caller.user_id, sourceType: input.sourceType },
        "[governance-cli] personal ingestion-key mint failed",
      );
      return c.json(
        { error: "server_error", error_description: "Could not mint an ingestion key" },
        500,
      );
    }
  }

  // ---------- GET /api/auth/cli/governance/ingestion-keys ----------
  // Every live (non-revoked) personal-project ingestion key for the caller's
  // organization. The CLI uses it as a cache-liveness pre-flight: revoking a
  // key on the platform would otherwise silently brick direct telemetry,
  // because the wrapper reuses a locally cached token forever. `lookup_id` is
  // the identifier embedded in the token prefix (`ik-lw-{lookupId}_…`), so the
  // CLI can match a cached token against a live entry without possessing the
  // full secret.
  secured.access(cliPolicy).get("/governance/ingestion-keys", async (c) => {
    const caller = await ports.accessTokens.resolve(c.req.header("Authorization"));
    if (!caller) return unauthorized(c);
    const keys = await ports.governance().ingestionKeyListForPersonalProject({
      userId: caller.user_id,
      organizationId: caller.organization_id,
    });
    return c.json(
      {
        keys: keys.map((key) => ({
          source_type: key.sourceType,
          lookup_id: key.lookupId,
          ingestion_template_id: key.ingestionTemplateId,
        })),
      },
      200,
    );
  });

  return secured.hono;
}

/**
 * A usable personal virtual key for the caller: the organization default on
 * the first ask, a device-named key afterwards.
 *
 * `ensureDefault` refuses to re-issue an existing default because its secret
 * is stored hashed, so a second machine needs a key of its own.
 */
async function issuePersonalVirtualKey(input: {
  governance: GovernanceService;
  ensurePersonalWorkspace: GovernanceCliRestPorts["ensurePersonalWorkspace"];
  userId: string;
  organizationId: string;
  displayName?: string | null;
  displayEmail?: string | null;
  deviceLabel: string | null;
}) {
  const { governance, userId, organizationId, displayName, displayEmail } = input;
  try {
    return await governance.personalVirtualKeyEnsureDefault({
      userId,
      organizationId,
      displayName,
      displayEmail,
    });
  } catch (err) {
    if (!(err instanceof PersonalVirtualKeyAlreadyExistsError)) throw err;
  }

  const workspace = await input.ensurePersonalWorkspace({
    organizationId,
    userId,
    displayName,
    displayEmail,
  });
  const suffix = input.deviceLabel ?? randomBytes(3).toString("hex");
  return await governance.personalVirtualKeyIssue({
    userId,
    organizationId,
    personalProjectId: workspace.project.id,
    personalTeamId: workspace.team.id,
    label: `device-${suffix}`,
  });
}
