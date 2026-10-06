import { randomBytes } from "node:crypto";

import type { AuthzPermission } from "@langwatch/authorization";
import {
  type EnterpriseGatewayApi,
  NoEligibleProvidersError,
  PersonalVirtualKeyAlreadyExistsError,
  RoutingPolicyHasNoProvidersError,
} from "@langwatch/enterprise-gateway-contract";
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

import { findDeviceLabel } from "../rules/device-label.rules.ts";
import type { DefaultGovernanceAiToolCatalogService } from "./ai-tool-catalog.service.ts";
import type { GovernanceCliCaller } from "./governance-cli-access.service.ts";
import {
  GovernanceCliIngestionKeyMintService,
  type GovernanceCliIngestionKeyOutcome,
  type GovernanceCliProject,
} from "./governance-cli-ingestion-key-mint.service.ts";
import type { OrganizationSupportContactService } from "./organization-support-contact.service.ts";
import type { PersonalIngestionKeyService } from "./personal-ingestion-key.service.ts";

const logger = createLogger("langwatch:governance-cli");

/** The personal workspace the credential routes resolve a project through. */
export type GovernanceCliPersonalWorkspace = Readonly<{
  team: Readonly<{ id: string }>;
  project: Readonly<{ id: string; slug: string; name: string }>;
}>;

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
  | Readonly<{ outcome: "resolved"; project: GovernanceCliProject }>
  | Readonly<{ outcome: "failed" }>;

export type GovernanceCliVirtualKeyOutcome =
  | Readonly<{ outcome: "issued"; id: string; secret: string; prefix: string }>
  | Readonly<{ outcome: "no-eligible-providers" }>
  | Readonly<{ outcome: "failed" }>;

/** Everything the credential operations reach that they do not own. */
export type GovernanceCliCredentialMembers = Readonly<{
  /** Enterprise gateway owns personal keys; the console's own doors call the same operations. */
  personalKeys: Pick<
    EnterpriseGatewayApi,
    "personalVirtualKeyList" | "personalVirtualKeyEnsureDefault" | "personalVirtualKeyIssue"
  >;
  ingestionKeys: Pick<PersonalIngestionKeyService, "issueForProject" | "mint">;
  aiTools: Pick<DefaultGovernanceAiToolCatalogService, "resolveToolPolicy">;
  users: Pick<UserApi, "findById">;
  projects: Pick<ProjectApi, "findLiveByRef">;
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
  mintIngestionKey(input: {
    caller: GovernanceCliCaller;
    sourceType: string;
    projectRef: string | undefined;
    deviceLabel: string | undefined;
  }): Promise<GovernanceCliIngestionKeyOutcome>;
}

export class GovernanceCliCredentialService implements GovernanceCliCredentialApi {
  private readonly mints: GovernanceCliIngestionKeyMintService;

  private constructor(private readonly members: GovernanceCliCredentialMembers) {
    this.mints = GovernanceCliIngestionKeyMintService.create(members);
  }

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

    const keys = await this.members.personalKeys.personalVirtualKeyList({
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

  /** The caller's personal workspace, ensured; it names the project and never its key. */
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
      const { id, slug, name } = workspace.project;

      return { outcome: "resolved", project: { id, slug, name } };
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

  /** A write-only `ik-lw-` key and its OTLP endpoint; see the mint service. */
  mintIngestionKey(input: {
    caller: GovernanceCliCaller;
    sourceType: string;
    projectRef: string | undefined;
    deviceLabel: string | undefined;
  }): Promise<GovernanceCliIngestionKeyOutcome> {
    return this.mints.mintIngestionKey(input);
  }

  private async ensureOrIssueVirtualKey(input: {
    caller: GovernanceCliCaller;
    displayName?: string | null;
    displayEmail?: string | null;
    deviceLabel: string | null;
  }) {
    const { user_id: userId, organization_id: organizationId } = input.caller;

    try {
      return await this.members.personalKeys.personalVirtualKeyEnsureDefault({
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

    return this.members.personalKeys.personalVirtualKeyIssue({
      userId,
      organizationId,
      personalProjectId: workspace.project.id,
      personalTeamId: workspace.team.id,
      label: `device-${suffix}`,
    });
  }

  private consoleBaseUrl(): string {
    return (this.members.publicBaseUrl ?? "http://localhost:5560").replace(/\/+$/, "");
  }
}
