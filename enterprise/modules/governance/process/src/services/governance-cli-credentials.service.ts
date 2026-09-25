import { randomBytes } from "node:crypto";

import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  NoEligibleProvidersError,
  IngestionKeySessionRevokedError,
  IngestionKeySourceNotAllowedError,
  IngestionKeyWorkspaceMissingError,
  PersonalVirtualKeyAlreadyExistsError,
  PLATFORM_TOOL_SLUG_BY_SOURCE_TYPE,
  RoutingPolicyHasNoProvidersError,
} from "@langwatch/enterprise-governance-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import { createLogger } from "@langwatch/observability";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Every credential `/api/auth/cli` hands back or mints, and the pre-flight
 * budget probe that decides whether a wrapped tool may run at all. The
 * transport renders these outcomes; every branch between them is decided here.
 */
import { TeamNotFoundError } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { UserApi } from "@langwatch/user-contract";

import type { DefaultGovernanceAiToolCatalogService } from "./ai-tool-catalog.service.ts";
import type { GovernanceCliCaller } from "./governance-cli-access.service.ts";
import type { DefaultGovernancePersonalVirtualKeyService } from "./governance-personal-key.service.ts";
import type { OrganizationSupportContactService } from "./organization-support-contact.service.ts";
import type { PersonalIngestionKeyService } from "./personal-ingestion-key.service.ts";

const logger = createLogger("langwatch:governance-cli");

/** The personal workspace the credential routes resolve a project through. */
export type GovernanceCliPersonalWorkspace = Readonly<{
  team: Readonly<{ id: string }>;
  project: Readonly<{ id: string; slug: string; name: string; apiKey: string }>;
}>;

/** One project, as the two handout routes answer it. */
export type GovernanceCliProject = Readonly<{ id: string; slug: string; name: string }>;

export type GovernanceCliBudgetStatus =
  | Readonly<{ outcome: "clear" }>
  | Readonly<{
      outcome: "blocked";
      scope: string;
      limitUsd: string;
      spentUsd: string;
      period: string;
      requestIncreaseUrl: string;
      adminEmail: string | null;
    }>;

export type GovernanceCliPersonalProjectOutcome =
  | Readonly<{ outcome: "resolved"; project: GovernanceCliProject & { apiKey: string } }>
  | Readonly<{ outcome: "failed" }>;

export type GovernanceCliVirtualKeyOutcome =
  | Readonly<{ outcome: "issued"; id: string; secret: string; prefix: string }>
  | Readonly<{ outcome: "no-eligible-providers" }>
  | Readonly<{ outcome: "failed" }>;

export type GovernanceCliProjectKeyOutcome =
  | Readonly<{ outcome: "granted"; apiKey: string; project: GovernanceCliProject }>
  | Readonly<{ outcome: "project-not-found"; slug: string }>
  | Readonly<{ outcome: "personal-project-not-allowed" }>
  | Readonly<{ outcome: "forbidden" }>;

export type GovernanceCliIngestionKeyOutcome =
  | Readonly<{
      outcome: "minted";
      token: string;
      prefix: string;
      endpoint: string;
      project?: GovernanceCliProject | undefined;
    }>
  | Readonly<{ outcome: "direct-otel-not-allowed"; toolSlug: string }>
  | Readonly<{ outcome: "project-not-found"; projectRef: string }>
  | Readonly<{ outcome: "personal-project-not-allowed" }>
  | Readonly<{ outcome: "forbidden" }>
  | Readonly<{ outcome: "source-type-not-personal"; sourceType: string }>
  | Readonly<{ outcome: "personal-workspace-missing" }>
  | Readonly<{ outcome: "session-signed-out" }>
  | Readonly<{ outcome: "failed" }>;

/** Everything the credential operations reach that they do not own. */
export type GovernanceCliCredentialMembers = Readonly<{
  /** The SAME services the console's tRPC procedures call. */
  personalKeys: Pick<
    DefaultGovernancePersonalVirtualKeyService,
    "list" | "ensureDefault" | "issue"
  >;
  ingestionKeys: Pick<PersonalIngestionKeyService, "issueForProject" | "mint">;
  aiTools: Pick<DefaultGovernanceAiToolCatalogService, "resolveToolPolicy">;
  users: Pick<UserApi, "findById">;
  projects: Pick<ProjectApi, "findLiveBySlug" | "findLiveByRef">;
  /** Who to point a blocked caller at, when a budget refuses the request. */
  supportContacts: () => Pick<OrganizationSupportContactService, "findSupportContact">;
  ensurePersonalWorkspace: (input: {
    organizationId: string;
    userId: string;
    displayName?: string | null;
    displayEmail?: string | null;
  }) => Promise<GovernanceCliPersonalWorkspace>;
  /** Throws `TeamNotFoundError` when the caller has no personal workspace here. */
  getPersonalWorkspace: (input: {
    organizationId: string;
    userId: string;
  }) => Promise<GovernanceCliPersonalWorkspace>;
  /**
   * Whether one person may do one thing to one project. PROJECT-tier, the
   * deployment's own AuthZ graph, which is why it arrives rather than being
   * resolved here.
   */
  permittedOnProject: (input: {
    userId: string;
    projectId: string;
    permission: AuthzPermission;
  }) => Promise<boolean>;
  /** The spend decision the gateway makes at request time, asked with zero projected cost. */
  budgets: Pick<GatewayApi, "checkBudget">;
  /** The deployment's public origin; the links this family answers are built from it. */
  publicBaseUrl?: string | undefined;
}>;

/** What the CLI governance transport hands back or mints. */
export interface GovernanceCliCredentialApi {
  budgetStatus: (caller: GovernanceCliCaller) => Promise<GovernanceCliBudgetStatus>;
  resolvePersonalProject(caller: GovernanceCliCaller): Promise<GovernanceCliPersonalProjectOutcome>;
  issuePersonalVirtualKey(input: {
    caller: GovernanceCliCaller;
    deviceLabel: string | undefined;
  }): Promise<GovernanceCliVirtualKeyOutcome>;
  handOutProjectKey(input: {
    caller: GovernanceCliCaller;
    slug: string;
  }): Promise<GovernanceCliProjectKeyOutcome>;
  mintIngestionKey(input: {
    caller: GovernanceCliCaller;
    sourceType: string;
    projectRef: string | undefined;
    deviceLabel: string | undefined;
  }): Promise<GovernanceCliIngestionKeyOutcome>;
}

/**
 * Reduce a free-form device label to the charset a key name carries. Returns
 * null when nothing usable survives, so the caller falls back to a random
 * suffix rather than naming every machine the same.
 */
function findDeviceLabel(raw: string | undefined | null): string | null {
  if (!raw) return null;

  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .slice(0, 24)
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return cleaned.length > 0 ? cleaned : null;
}

export class GovernanceCliCredentialService implements GovernanceCliCredentialApi {
  private constructor(private readonly members: GovernanceCliCredentialMembers) {}

  static create(members: GovernanceCliCredentialMembers): GovernanceCliCredentialService {
    return new GovernanceCliCredentialService(members);
  }

  /**
   * The pre-flight every wrapped tool runs before it execs. Each missing
   * precondition — no workspace, no personal key, no spend store — reads clear
   * rather than blocking: nothing can be over a budget it never reached.
   */
  async budgetStatus(caller: GovernanceCliCaller): Promise<GovernanceCliBudgetStatus> {
    const workspace = await this.members
      .getPersonalWorkspace({
        organizationId: caller.organization_id,
        userId: caller.user_id,
      })
      .catch((error: unknown) => {
        if (TeamNotFoundError.is(error)) return null;
        throw error;
      });

    if (!workspace) return { outcome: "clear" };

    const keys = await this.members.personalKeys.list({
      userId: caller.user_id,
      organizationId: caller.organization_id,
    });
    const personalKey = keys[0];
    if (!personalKey) return { outcome: "clear" };

    const decision = await this.members.budgets.checkBudget({
      organizationId: caller.organization_id,
      teamId: workspace.team.id,
      projectId: workspace.project.id,
      virtualKeyId: personalKey.id,
      principalUserId: caller.user_id,
      projectedCostUsd: 0,
    });

    // The check result orders by strictness, so the first entry is binding.
    const blocker = decision.decision === "hard_block" ? decision.blockedBy[0] : void 0;

    if (!blocker) return { outcome: "clear" };

    const adminEmail = await this.members
      .supportContacts()
      .findSupportContact({ organizationId: caller.organization_id });
    const params = new URLSearchParams({
      scope: blocker.scope.toLowerCase(),
      scope_id: blocker.scopeId,
      limit_usd: blocker.limitUsd,
      spent_usd: blocker.spentUsd,
    });

    return {
      outcome: "blocked",
      scope: blocker.scope.toLowerCase(),
      limitUsd: blocker.limitUsd,
      spentUsd: blocker.spentUsd,
      period: blocker.window.toLowerCase(),
      requestIncreaseUrl: `${this.consoleBaseUrl()}/me/budget/request?${params.toString()}`,
      adminEmail,
    };
  }

  /** Lazy personal-key exchange for sessions minted before the exchange shipped one. */
  async resolvePersonalProject(
    caller: GovernanceCliCaller,
  ): Promise<GovernanceCliPersonalProjectOutcome> {
    const person = await this.members.users.findById({ id: caller.user_id });

    try {
      const workspace = await this.members.ensurePersonalWorkspace({
        organizationId: caller.organization_id,
        userId: caller.user_id,
        displayName: person?.name,
        displayEmail: person?.email,
      });

      return { outcome: "resolved", project: workspace.project };
    } catch (err) {
      logger.error(
        { err, userId: caller.user_id },
        "[governance-cli] personal-project resolution failed",
      );

      return { outcome: "failed" };
    }
  }

  /**
   * A usable personal virtual key: the organization default on the first ask,
   * a device-named key afterwards, because `ensureDefault` refuses to re-issue
   * an existing default whose secret is stored hashed.
   */
  async issuePersonalVirtualKey(input: {
    caller: GovernanceCliCaller;
    deviceLabel: string | undefined;
  }): Promise<GovernanceCliVirtualKeyOutcome> {
    const { caller } = input;
    const person = await this.members.users.findById({ id: caller.user_id });

    try {
      const issued = await this.ensureOrIssueVirtualKey({
        caller,
        displayName: person?.name,
        displayEmail: person?.email,
        deviceLabel: findDeviceLabel(input.deviceLabel),
      });

      return {
        outcome: "issued",
        id: issued.virtualKey.id,
        secret: issued.secret,
        prefix: issued.virtualKey.displayPrefix,
      };
    } catch (err) {
      // Both empty-provider causes collapse into one refusal: whether the
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

        return { outcome: "no-eligible-providers" };
      }

      logger.error(
        { err, userId: caller.user_id },
        "[governance-cli] personal virtual key issuance failed",
      );

      return { outcome: "failed" };
    }
  }

  /**
   * Non-interactive project login. Nothing is minted — the project's existing
   * key is returned — and because that key is the shared write credential
   * usable outside the console's RBAC constraints, membership alone is not
   * enough: the caller needs administrative project permission.
   */
  async handOutProjectKey(input: {
    caller: GovernanceCliCaller;
    slug: string;
  }): Promise<GovernanceCliProjectKeyOutcome> {
    const [project] = await this.members.projects.findLiveBySlug({
      slug: input.slug,
      organizationId: input.caller.organization_id,
    });

    if (!project) return { outcome: "project-not-found", slug: input.slug };

    // Another person's personal workspace is theirs alone; no permission grant
    // makes a second principal's key into it legitimate.
    if (project.isPersonal && project.ownerUserId !== input.caller.user_id) {
      return { outcome: "personal-project-not-allowed" };
    }

    const permitted = await this.members.permittedOnProject({
      userId: input.caller.user_id,
      projectId: project.id,
      permission: "project:manage",
    });

    if (!permitted) return { outcome: "forbidden" };

    return {
      outcome: "granted",
      apiKey: project.apiKey,
      project: { id: project.id, slug: project.slug, name: project.name },
    };
  }

  /**
   * A write-only `ik-lw-` key and its OTLP endpoint. Without a project ref the
   * caller's personal project is used; with one, that project — resolved
   * inside the caller's organization only.
   */
  async mintIngestionKey(input: {
    caller: GovernanceCliCaller;
    sourceType: string;
    projectRef: string | undefined;
    deviceLabel: string | undefined;
  }): Promise<GovernanceCliIngestionKeyOutcome> {
    const policed = await this.directOtelPolicy(input);

    if (policed) return policed;

    if (input.projectRef !== void 0) {
      return this.mintProjectIngestionKey({ ...input, projectRef: input.projectRef });
    }

    return this.mintPersonalIngestionKey(input);
  }

  /**
   * Apply the declared tool's direct-OTLP policy: a mint naming a tool the
   * organization turned off is refused, which catches an old CLI, a stale
   * cached policy, or a hand-run of the documented flow. Only source types a
   * wrapped tool stamps are governed; anything else has no per-tool policy.
   */
  private async directOtelPolicy(input: {
    caller: GovernanceCliCaller;
    sourceType: string;
  }): Promise<GovernanceCliIngestionKeyOutcome | null> {
    // `Object.hasOwn` rather than a plain lookup: the key is request-
    // controlled, so `"toString"` would otherwise resolve an inherited
    // function, pass a truthy check, and index the policy map with nothing.
    const toolSlug = Object.hasOwn(PLATFORM_TOOL_SLUG_BY_SOURCE_TYPE, input.sourceType)
      ? PLATFORM_TOOL_SLUG_BY_SOURCE_TYPE[input.sourceType]
      : void 0;

    if (!toolSlug) return null;

    const policy = await this.members.aiTools.resolveToolPolicy({
      organizationId: input.caller.organization_id,
      userId: input.caller.user_id,
      slug: toolSlug,
    });

    return policy.allowOtelDirect ? null : { outcome: "direct-otel-not-allowed", toolSlug };
  }

  /**
   * `projectRef` is read as an id first, then as a slug, and both lookups stay
   * inside the caller's organization: a project in another tenant reports the
   * same absence as one that does not exist. Membership does not authorize the
   * mint — the caller needs the very grant the minted key carries.
   */
  private async mintProjectIngestionKey(input: {
    caller: GovernanceCliCaller;
    projectRef: string;
    sourceType: string;
    deviceLabel: string | undefined;
  }): Promise<GovernanceCliIngestionKeyOutcome> {
    const [project] = await this.members.projects.findLiveByRef({
      projectRef: input.projectRef,
      organizationId: input.caller.organization_id,
    });

    if (!project) return { outcome: "project-not-found", projectRef: input.projectRef };

    if (project.isPersonal && project.ownerUserId !== input.caller.user_id) {
      return { outcome: "personal-project-not-allowed" };
    }

    const permitted = await this.members.permittedOnProject({
      userId: input.caller.user_id,
      projectId: project.id,
      permission: "traces:create",
    });

    if (!permitted) return { outcome: "forbidden" };

    try {
      const result = await this.members.ingestionKeys.issueForProject({
        callerUserId: input.caller.user_id,
        // A shared project's key is an org service key, owned by nobody, so it
        // stays visible to the whole team. The caller's own personal workspace
        // is the exception: only its owner may hold a key that reaches it.
        ownerUserId: project.isPersonal ? input.caller.user_id : null,
        organizationId: input.caller.organization_id,
        projectId: project.id,
        sourceType: input.sourceType,
        // The label lands inside the key's display name, so it goes through
        // the same reduction a virtual-key label does.
        createdByDeviceLabel: findDeviceLabel(
          input.deviceLabel ??
            input.caller.client_info?.device_label ??
            input.caller.client_info?.hostname ??
            void 0,
        ),
      });

      return {
        outcome: "minted",
        token: result.token,
        prefix: result.prefix,
        endpoint: this.otlpEndpoint(),
        project: { id: project.id, slug: project.slug, name: project.name },
      };
    } catch (err) {
      logger.error(
        { err, projectId: project.id, sourceType: input.sourceType },
        "[governance-cli] project ingestion-key mint failed",
      );

      return { outcome: "failed" };
    }
  }

  /**
   * The caller's own workspace, one key per device. Create-only, because the
   * other devices under this login are still exporting with theirs; the
   * key lives and dies with this device's session (its login key).
   */
  private async mintPersonalIngestionKey(input: {
    caller: GovernanceCliCaller;
    sourceType: string;
  }): Promise<GovernanceCliIngestionKeyOutcome> {
    try {
      const result = await this.members.ingestionKeys.mint({
        userId: input.caller.user_id,
        organizationId: input.caller.organization_id,
        sourceType: input.sourceType,
        fromCliSession: true,
        parentApiKeyId: input.caller.cli_api_key_id ?? null,
        // Snapshot which device minted the key so the API-keys settings page
        // can attribute it; null for CLIs that predate device metadata.
        createdByDeviceLabel:
          input.caller.client_info?.device_label ?? input.caller.client_info?.hostname ?? null,
      });

      return {
        outcome: "minted",
        token: result.token,
        prefix: result.prefix,
        endpoint: this.otlpEndpoint(),
      };
    } catch (err) {
      // A source type no wrapped tool stamps and a missing workspace are the
      // two failures the caller can act on, so they are the only ones that
      // report as such. Everything else is a server fault.
      if (IngestionKeySourceNotAllowedError.is(err)) {
        return { outcome: "source-type-not-personal", sourceType: input.sourceType };
      }

      if (IngestionKeyWorkspaceMissingError.is(err)) {
        return { outcome: "personal-workspace-missing" };
      }

      if (IngestionKeySessionRevokedError.is(err)) {
        return { outcome: "session-signed-out" };
      }

      logger.error(
        { err, userId: input.caller.user_id, sourceType: input.sourceType },
        "[governance-cli] personal ingestion-key mint failed",
      );

      return { outcome: "failed" };
    }
  }

  private async ensureOrIssueVirtualKey(input: {
    caller: GovernanceCliCaller;
    displayName?: string | null;
    displayEmail?: string | null;
    deviceLabel: string | null;
  }) {
    const { user_id: userId, organization_id: organizationId } = input.caller;

    try {
      return await this.members.personalKeys.ensureDefault({
        userId,
        organizationId,
        displayName: input.displayName,
        displayEmail: input.displayEmail,
      });
    } catch (err) {
      if (!(err instanceof PersonalVirtualKeyAlreadyExistsError)) throw err;
    }

    const workspace = await this.members.ensurePersonalWorkspace({
      organizationId,
      userId,
      displayName: input.displayName,
      displayEmail: input.displayEmail,
    });
    const suffix = input.deviceLabel ?? randomBytes(3).toString("hex");

    return this.members.personalKeys.issue({
      userId,
      organizationId,
      personalProjectId: workspace.project.id,
      personalTeamId: workspace.team.id,
      label: `device-${suffix}`,
    });
  }

  /** The control-plane origin the CLI persists, and the OTLP endpoint's root. */
  private otlpEndpoint(): string {
    return `${(this.members.publicBaseUrl ?? "https://app.langwatch.ai").replace(/\/+$/, "")}/api/otel`;
  }

  private consoleBaseUrl(): string {
    return (this.members.publicBaseUrl ?? "http://localhost:5560").replace(/\/+$/, "");
  }
}
