import {
  LEGACY_PROJECT_KEY_LOGGER_NAME,
  legacyProjectKeyUseLines,
  legacyProjectKeyUseSpanAttributes,
  legacyProjectKeyUseWindowKey,
  type LegacyProjectKeyUse,
} from "@langwatch/api-key-contract";
import {
  legacyProjectKeyHasFullAccess,
  legacyProjectKeyScopeEnforced,
  type FeatureFlagApi,
} from "@langwatch/feature-flag-contract";
import { createLogger, createWarnThrottle, type Logger } from "@langwatch/observability";
import { isAggregateProjectKind, type ProjectApi } from "@langwatch/project-contract";
import { nowInstant } from "@langwatch/time";
import { trace } from "@opentelemetry/api";

/** One legacy key line per project, route, permission and kind per minute in this process. */
const LEGACY_KEY_LOG_WINDOW_MS = 60_000;

/** What the legacy key lines name the hosted MCP as; it asks no permission. */
const HOSTED_MCP_ROUTE = "MCP /mcp";

/**
 * A key read: the live project it belongs to, a legacy key whose project keeps it to ingestion,
 * or an unknown key the caller refuses.
 */
export type McpLiveProjectLookup =
  | { kind: "live"; project: { id: string; teamId: string } }
  | { kind: "ingestion_only" }
  | { kind: "unknown" };

/**
 * The project an MCP bearer token belongs to, read through the project
 * module's own peer capability rather than this module's tables.
 */
export class ProjectMcpProjectLookupService {
  readonly #projects: ProjectApi;
  readonly #featureFlags: Pick<FeatureFlagApi, "isEnabled">;
  readonly #logger: Pick<Logger, "info" | "warn">;
  /** One legacy key line per project per window in this process. */
  readonly #window = createWarnThrottle(LEGACY_KEY_LOG_WINDOW_MS);

  private constructor(
    projects: ProjectApi,
    featureFlags: Pick<FeatureFlagApi, "isEnabled">,
    logger: Pick<Logger, "info" | "warn">,
  ) {
    this.#projects = projects;
    this.#featureFlags = featureFlags;
    this.#logger = logger;
  }

  static create({
    projects,
    featureFlags,
    logger = createLogger(LEGACY_PROJECT_KEY_LOGGER_NAME),
  }: {
    projects: ProjectApi;
    featureFlags: Pick<FeatureFlagApi, "isEnabled">;
    logger?: Pick<Logger, "info" | "warn">;
  }): ProjectMcpProjectLookupService {
    return new ProjectMcpProjectLookupService(projects, featureFlags, logger);
  }

  async resolveLiveProjectByApiKey(input: { apiKey: string }): Promise<McpLiveProjectLookup> {
    const projectId = await this.#projects.findIdByLegacyApiKey({ token: input.apiKey });
    if (!projectId) return { kind: "unknown" };

    const identity = await this.#projects.findIdentity(projectId);
    // ADR-144 decision 7: an aggregate accepts no key, its own included.
    if (!identity || isAggregateProjectKind(identity.kind)) return { kind: "unknown" };

    const live = { kind: "live", project: { id: identity.id, teamId: identity.teamId } } as const;
    // The bearer is the project's legacy key: past ingestion unless full access, so it is logged,
    // and refused once its project is enforced.
    const flags = { featureFlags: this.#featureFlags, project: identity };
    if (await legacyProjectKeyHasFullAccess(flags)) return live;
    const enforced = await legacyProjectKeyScopeEnforced(flags);
    this.#recordOutsideScope({ project: identity, enforced });

    return enforced ? { kind: "ingestion_only" } : live;
  }

  #recordOutsideScope(input: {
    project: Readonly<{ id: string; organizationId: string }>;
    enforced: boolean;
  }): void {
    const use: LegacyProjectKeyUse = {
      projectId: input.project.id,
      organizationId: input.project.organizationId,
      route: HOSTED_MCP_ROUTE,
      permission: null,
      routeScopes: [],
    };
    const decision = { outsideScope: true, enforced: input.enforced } as const;
    trace.getActiveSpan()?.setAttributes(legacyProjectKeyUseSpanAttributes({ use, decision }));
    const suppressed = this.#window.claim({
      key: legacyProjectKeyUseWindowKey(use),
      now: nowInstant().epochMilliseconds,
    });
    if (suppressed === undefined) return;
    for (const line of legacyProjectKeyUseLines({ use, decision, suppressed })) {
      this.#logger[line.level](line.fields, line.message);
    }
  }
}
