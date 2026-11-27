import { isUpgradeInProgress } from "@langwatch/api";
import type { Authorization, PrincipalRef } from "@langwatch/authorization";
import type { AuthzApi } from "@langwatch/authz-contract";
import {
  askViewerRolePermissions,
  describeAudience,
  isContentVisible,
  isContentVisibleToPublic,
  needsOwnerFact,
  needsRoleEverywhere,
  ownsEveryGovernedProject,
  viewerFactsFrom,
  type ContentCategory,
  type ResolvedCategory,
  type ResolvedDataPrivacy,
  type DataPrivacyApi,
  type HeldRolePermissions,
  type ViewerRolePermission,
} from "@langwatch/data-privacy-contract";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import type { ProjectApi } from "@langwatch/project-contract";
import type { Protections } from "@langwatch/trace-contract";

import { policyProjectIdsOf } from "../rules/policy-project-ids.rules.ts";
import {
  type VisibilityWindow,
  VisibilityWindowService,
} from "./trace-visibility-window.service.ts";

export type TraceViewerProtectionOptions = Readonly<{
  authz: AuthzApi;
  projects: ProjectApi;
  plans: PlanProvider;
  dataPrivacy: DataPrivacyApi;
  fallbackVisibilityDays: number;
  now?: () => number;
  logger?: Logger;
}>;

export class TraceViewerProtectionService {
  static create(options: TraceViewerProtectionOptions): TraceViewerProtectionService {
    return new TraceViewerProtectionService(options);
  }

  private readonly window: VisibilityWindowService;
  private readonly logger: Logger;
  private readonly now: () => number;

  private constructor(private readonly options: TraceViewerProtectionOptions) {
    this.window = VisibilityWindowService.create(options.plans);
    this.logger = options.logger ?? createLogger("langwatch:trace:protections");
    this.now = options.now ?? Date.now;
  }

  /** Failing closed teases old content but withholds nothing: an outage never hides new traces. */
  async getVisibilityWindow(projectId: string): Promise<VisibilityWindow> {
    const dayMs = 24 * 60 * 60 * 1000;
    const failClosed = (): VisibilityWindow => ({
      visibilityCutoffMs: this.now() - this.options.fallbackVisibilityDays * dayMs,
      withheldFromMs: null,
      overPlan: null,
    });
    try {
      const project = await this.options.projects.findWithTeam(projectId);
      const organizationId = project?.team?.organizationId;
      if (!organizationId) {
        this.logger.error(
          { projectId },
          "visibility window failing closed: project resolves to no organization",
        );
        return failClosed();
      }
      return await this.window.getVisibilityWindow({ organizationId });
    } catch (error) {
      this.logger[isUpgradeInProgress(error) ? "info" : "error"](
        { projectId, error },
        "visibility window failing closed: plan resolution failed",
      );
      return failClosed();
    }
  }

  /** Credential redactions: an access token (a `user` principal) reads content as its person,
   * a key as the public; costs are the credential's own grant. A legacy key sees costs. */
  async resolveForApiKey(
    input: Readonly<{
      projectId: string;
      principal: PrincipalRef | null;
      authorization?: Authorization;
      /** False outside the token's own project: there it reads as the public. */
      readsAsPerson?: boolean;
    }>,
  ): Promise<Protections> {
    const personId =
      input.readsAsPerson !== false && input.principal?.type === "user"
        ? input.principal.id
        : void 0;
    const proof = input.authorization;
    const ownProof =
      personId && proof?.principal.type === "user" && proof.principal.id === personId;
    const [protections, canSeeCosts] = await Promise.all([
      this.resolve({
        projectId: input.projectId,
        userId: personId,
        publiclyShared: false,
        ...(ownProof ? { authorization: proof } : {}),
      }),
      this.keyPermitted(input),
    ]);
    return { ...protections, canSeeCosts };
  }

  /** One permission, asked of the CREDENTIAL rather than of whoever holds it. */
  private async keyPermitted(
    input: Readonly<{ projectId: string; principal: PrincipalRef | null }>,
  ): Promise<boolean> {
    if (input.principal === null) return true;
    const project = await this.options.projects.findIdentity(input.projectId);
    if (!project) return false;

    return this.options.authz.can({
      principal: input.principal,
      permission: "cost:view",
      scope: {
        type: "project",
        id: project.id,
        teamId: project.teamId,
        organizationId: project.organizationId,
      },
    });
  }

  async resolve(
    input: Readonly<{
      projectId: string;
      userId: string | undefined;
      publiclyShared: boolean;
      /** The read's proof: the policy is the strictest across it and `projectId` (ADR-177 d9). */
      authorization?: Authorization;
    }>,
  ): Promise<Protections> {
    const policyProjectIds = policyProjectIdsOf(input);
    const [canSeeCosts, held, window] = await Promise.all([
      this.permitted(input, "cost:view"),
      this.heldAt({ ...input, at: input.projectId }),
      this.getVisibilityWindow(input.projectId),
    ]);

    let policy: ResolvedDataPrivacy;
    try {
      policy = await this.options.dataPrivacy.getResolvedForProjects({
        projectIds: policyProjectIds,
      });
    } catch (error) {
      this.logger.error(
        { error, projectId: input.projectId },
        "data-privacy policy resolution failed; hiding captured content (fail-closed)",
      );
      return {
        canSeeCosts,
        canSeeCapturedInput: false,
        canSeeCapturedOutput: false,
        capturedInputVisibleTo: null,
        capturedOutputVisibleTo: null,
        contentCategories: uniformContentCategories(false),
        hiddenAttributes: [{ pattern: "*", visibleTo: "members of this project" }],
        ...window,
      };
    }

    const restricted = policy.customAttributes.filter((rule) => rule.disposition === "restrict");
    const restrictions = CONTENT_CATEGORIES.map((category) => policy.categories[category]);
    const [heldElsewhere, isProjectOwner] = await Promise.all([
      restrictions.some(needsRoleEverywhere)
        ? Promise.all(
            policyProjectIds
              .filter((id) => id !== input.projectId)
              .map((at) => this.heldAt({ ...input, at })),
          )
        : Promise.resolve([]),
      needsOwnerFact({ restrictions, isMember: held["traces:view"] })
        ? this.isProjectOwner({ ...input, projectIds: policyProjectIds })
        : Promise.resolve(false),
    ]);
    const categories = await this.categoriesFor({
      policy,
      projectId: input.projectId,
      userId: input.userId,
      anonymous: input.publiclyShared || input.userId === undefined,
      held,
      heldElsewhere,
      isProjectOwner,
    });

    return {
      canSeeCosts,
      canSeeCapturedInput: categories?.input.canSee ?? false,
      canSeeCapturedOutput: categories?.output.canSee ?? false,
      capturedInputVisibleTo: categories?.input.restrictVisibleTo ?? null,
      capturedOutputVisibleTo: categories?.output.restrictVisibleTo ?? null,
      contentCategories: categories,
      hiddenAttributes: restricted.map((rule) => ({
        pattern: rule.pattern,
        visibleTo: "members of this project",
      })),
      restrictedAttributes: restricted.map((rule) => ({
        pattern: rule.pattern,
        visibleTo: "members of this project",
        canSee: false,
      })),
      ...window,
    };
  }

  private async categoriesFor({
    policy,
    projectId,
    userId,
    anonymous,
    held,
    heldElsewhere,
    isProjectOwner,
  }: {
    policy: ResolvedDataPrivacy;
    projectId: string;
    userId: string | undefined;
    anonymous: boolean;
    held: HeldRolePermissions;
    heldElsewhere: readonly HeldRolePermissions[];
    isProjectOwner: boolean;
  }): Promise<Protections["contentCategories"]> {
    const groupIds = anonymous ? [] : await this.groupIdsFor({ policy, projectId, userId });
    const viewer = viewerFactsFrom({ held, heldElsewhere, isProjectOwner, groupIds });

    return Object.fromEntries(
      CONTENT_CATEGORIES.map((category) => {
        const resolved = policy.categories[category];
        return [
          category,
          {
            canSee: anonymous
              ? isContentVisibleToPublic(resolved)
              : isContentVisible(resolved, viewer),
            restrictVisibleTo: formatRestrictLabel(resolved),
          },
        ];
      }),
    ) as Protections["contentCategories"];
  }

  /** Ownership read the one shared way, over every project whose policy governs the read. */
  private isProjectOwner(
    input: Readonly<{ projectId: string; userId: string | undefined; projectIds: string[] }>,
  ): Promise<boolean> {
    return ownsEveryGovernedProject({
      userId: input.userId,
      projectIds: input.projectIds,
      ownerOf: async (projectId) =>
        (await this.options.projects.findWithTeam(projectId))?.ownerUserId,
      onLookupFailure: (error) =>
        this.logger.error(
          { projectIds: input.projectIds, error },
          "project owner resolution failed; treating the viewer as not the owner (fail-closed)",
        ),
    });
  }

  /** The viewer's role permissions at one project the read spans. */
  private heldAt(
    input: Readonly<{ at: string; userId: string | undefined }>,
  ): Promise<HeldRolePermissions> {
    return askViewerRolePermissions((permission) =>
      this.permitted({ projectId: input.at, userId: input.userId }, permission),
    );
  }

  /**
   * The member's groups in the organization, read only when a content audience names a group.
   * Fail-closed: a read that throws answers no groups, which can only narrow what they see.
   */
  private async groupIdsFor({
    policy,
    projectId,
    userId,
  }: {
    policy: ResolvedDataPrivacy;
    projectId: string;
    userId: string | undefined;
  }): Promise<string[]> {
    const namesGroup = CONTENT_CATEGORIES.some(
      (category) => policy.categories[category].audience.groupIds.length > 0,
    );
    if (userId === undefined || !namesGroup) return [];
    try {
      const project = await this.options.projects.findWithTeam(projectId);
      const organizationId = project?.team?.organizationId;
      if (!organizationId) return [];
      const breakdown = await this.options.authz.getAccessBreakdown({
        organizationId,
        userId,
        userName: null,
        userEmail: null,
      });
      return breakdown.groups.map((group) => group.id);
    } catch (error) {
      this.logger.error(
        { projectId, error },
        "group membership read failed; content audiences by group stay closed (fail-closed)",
      );
      return [];
    }
  }

  private permitted(
    input: Readonly<{ projectId: string; userId: string | undefined }>,
    permission: "cost:view" | ViewerRolePermission,
  ): Promise<boolean> {
    if (input.userId === undefined) return Promise.resolve(false);
    return this.options.authz.hasPermission({
      userId: input.userId,
      permission,
      projectId: input.projectId,
    });
  }
}

const CONTENT_CATEGORIES = ["input", "output", "system", "tools"] as const;

function uniformContentCategories(canSee: boolean): Protections["contentCategories"] {
  return Object.fromEntries(
    CONTENT_CATEGORIES.map((category: ContentCategory) => [
      category,
      { canSee, restrictVisibleTo: null },
    ]),
  ) as Protections["contentCategories"];
}

function formatRestrictLabel(category: ResolvedCategory): string | null {
  return category.disposition === "restrict"
    ? describeAudience(category.audience, { groups: {} })
    : null;
}
