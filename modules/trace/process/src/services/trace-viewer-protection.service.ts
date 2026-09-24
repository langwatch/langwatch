import type { AuthzApi } from "@langwatch/authz-contract";
import {
  describeAudience,
  isContentVisible,
  isContentVisibleToPublic,
  type ContentCategory,
  type ResolvedCategory,
  type ResolvedDataPrivacy,
  type DataPrivacyApi,
} from "@langwatch/data-privacy-contract";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import type { ProjectApi } from "@langwatch/project-contract";
import type { Protections } from "@langwatch/trace-contract";

import { VisibilityWindowService } from "./trace-visibility-window.service.ts";

export type TraceViewerProtectionOptions = Readonly<{
  authz: AuthzApi;
  projects: ProjectApi;
  plans: PlanProvider;
  dataPrivacy: DataPrivacyApi;
  fallbackVisibilityDays: number;
  processName: string;
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
    this.logger = options.logger ?? createLogger(`${options.processName}:trace-protections`);
    this.now = options.now ?? Date.now;
  }

  async getVisibilityWindow(projectId: string): Promise<{ visibilityCutoffMs: number | null }> {
    const dayMs = 24 * 60 * 60 * 1000;
    try {
      const project = await this.options.projects.findWithTeam(projectId);
      const organizationId = project?.team?.organizationId;
      if (!organizationId) {
        this.logger.error(
          { projectId },
          "visibility window failing closed: project resolves to no organization",
        );
        return { visibilityCutoffMs: this.now() - this.options.fallbackVisibilityDays * dayMs };
      }
      return await this.window.getVisibilityWindow({ organizationId });
    } catch (error) {
      this.logger.error(
        { projectId, error },
        "visibility window failing closed: plan resolution failed",
      );
      return { visibilityCutoffMs: this.now() - this.options.fallbackVisibilityDays * dayMs };
    }
  }

  /** API-KEY redactions: anonymous resolution + credential's cost grant.
   * Legacy keys bypass RBAC for full access. */
  async resolveForApiKey(
    input: Readonly<{ projectId: string; apiKeyId: string | null; userId: string | null }>,
  ): Promise<Protections> {
    const [protections, canSeeCosts] = await Promise.all([
      this.resolve({ projectId: input.projectId, userId: void 0, publiclyShared: false }),
      this.keyPermitted(input),
    ]);
    return { ...protections, canSeeCosts };
  }

  /** One permission, asked of the CREDENTIAL rather than of whoever holds it. */
  private keyPermitted(
    input: Readonly<{ projectId: string; apiKeyId: string | null; userId: string | null }>,
  ): Promise<boolean> {
    if (input.apiKeyId === null) return Promise.resolve(true);
    return this.options.authz.hasApiKeyPermission({
      apiKeyId: input.apiKeyId,
      userId: input.userId,
      organizationId: "",
      scope: { type: "project", id: input.projectId, teamId: "" },
      permission: "cost:view",
    });
  }

  async resolve(
    input: Readonly<{ projectId: string; userId: string | undefined; publiclyShared: boolean }>,
  ): Promise<Protections> {
    const [canSeeCosts, isMember, isAdmin, isProjectOwner, { visibilityCutoffMs }] =
      await Promise.all([
        this.permitted(input, "cost:view"),
        this.permitted(input, "traces:view"),
        this.permitted(input, "project:update"),
        this.isProjectOwner(input),
        this.getVisibilityWindow(input.projectId),
      ]);

    let policy: ResolvedDataPrivacy;
    try {
      policy = await this.options.dataPrivacy.getResolvedForProject({ projectId: input.projectId });
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
        visibilityCutoffMs,
      };
    }

    const restricted = policy.customAttributes.filter((rule) => rule.disposition === "restrict");
    const anonymous = input.publiclyShared || input.userId === undefined;
    const categories = Object.fromEntries(
      CONTENT_CATEGORIES.map((category) => {
        const resolved = policy.categories[category];
        return [
          category,
          {
            canSee: anonymous
              ? isContentVisibleToPublic(resolved)
              : isContentVisible(resolved, {
                  isAdmin,
                  isMember,
                  isMemberRole: isMember,
                  isViewer: isMember && !isAdmin,
                  isProjectOwner,
                  groupIds: [],
                }),
            restrictVisibleTo: formatRestrictLabel(resolved),
          },
        ];
      }),
    ) as Protections["contentCategories"];

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
      visibilityCutoffMs,
    };
  }

  /** Whether the viewer owns the project; unknown ownership is not ownership. */
  private async isProjectOwner(
    input: Readonly<{ projectId: string; userId: string | undefined }>,
  ): Promise<boolean> {
    if (input.userId === undefined) return false;
    try {
      const project = await this.options.projects.findWithTeam(input.projectId);
      return project?.ownerUserId != null && project.ownerUserId === input.userId;
    } catch (error) {
      this.logger.error(
        { projectId: input.projectId, error },
        "project owner resolution failed; treating the viewer as not the owner (fail-closed)",
      );
      return false;
    }
  }

  private permitted(
    input: Readonly<{ projectId: string; userId: string | undefined }>,
    permission: "cost:view" | "traces:view" | "project:update",
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
