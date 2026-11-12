import {
  INGESTION_PERMISSIONS,
  LEGACY_PROJECT_KEY_LOG_WINDOW_MS,
  LEGACY_PROJECT_KEY_LOGGER_NAME,
  LegacyProjectKeyIngestionOnlyError,
  legacyProjectKeyScopeFlagSchema,
  legacyProjectKeyUseLines,
  legacyProjectKeyUseSpanAttributes,
  legacyProjectKeyUseWindowKey,
  type LegacyProjectKeyUse,
  type LegacyProjectKeyUseDecision,
} from "@langwatch/api-key-contract";
import type { AuthzPermission } from "@langwatch/authorization";
import {
  legacyProjectKeyHasFullAccess,
  legacyProjectKeyScopeEnforced,
  type FeatureFlagApi,
} from "@langwatch/feature-flag-contract";
import { createLogger, createWarnThrottle, type Logger } from "@langwatch/observability";
import { trace } from "@opentelemetry/api";

/** The project a legacy key is, as far as its scope is concerned. */
type LegacyKeyProject = Readonly<{ id: string; organizationId: string }>;

/** One legacy key request: its project, the permission asked, and the route that asked it. */
type LegacyKeyAsk = Readonly<{
  project: LegacyKeyProject;
  /** Null on a route that only identifies the caller. */
  permission: AuthzPermission | null;
  /** `METHOD /path/:param`, never the concrete URL. */
  route: string;
  routeScopes?: readonly string[];
}>;

/**
 * A legacy key holds ingestion, a route naming a scope flag that lists its project, and all on
 * full access. Anything else is allowed and logged, or refused on an enforced project
 * (spec: modules/auth/specs/legacy-project-key-scope.feature).
 */
export class LegacyProjectKeyScopeService {
  static create(peers: {
    featureFlags: Pick<FeatureFlagApi, "isEnabled">;
    logger?: Pick<Logger, "info" | "warn">;
    now?: () => number;
  }): LegacyProjectKeyScopeService {
    return new LegacyProjectKeyScopeService(
      peers.featureFlags,
      peers.logger ?? createLogger(LEGACY_PROJECT_KEY_LOGGER_NAME),
      peers.now ?? Date.now,
    );
  }

  /** One line per project, route and permission per window: the census needs presence. */
  private readonly window = createWarnThrottle(LEGACY_PROJECT_KEY_LOG_WINDOW_MS);

  private constructor(
    private readonly featureFlags: Pick<FeatureFlagApi, "isEnabled">,
    private readonly logger: Pick<Logger, "info" | "warn">,
    private readonly now: () => number,
  ) {}

  /** Reads only the scope flags the route names, then full access, then enforcement. */
  async holds(input: LegacyKeyAsk): Promise<boolean> {
    const { project, permission, routeScopes = [] } = input;
    if (permission !== null && INGESTION_PERMISSIONS.includes(permission)) return true;

    for (const scope of routeScopes) {
      const flag = legacyProjectKeyScopeFlagSchema.parse(scope);
      if (await this.featureFlags.isEnabled(flag, this.#target(project))) {
        this.#record(input, { outsideScope: false, grantedBy: flag });
        return true;
      }
    }

    if (await legacyProjectKeyHasFullAccess({ featureFlags: this.featureFlags, project })) {
      return true;
    }

    const enforced = await legacyProjectKeyScopeEnforced({
      featureFlags: this.featureFlags,
      project,
    });
    this.#record(input, { outsideScope: true, enforced });

    return !enforced;
  }

  /** A route that asks no permission names no scope flag: full access opens it, or report-only. */
  async assertMayIdentify(input: Omit<LegacyKeyAsk, "permission" | "routeScopes">): Promise<void> {
    if (!(await this.holds({ ...input, permission: null }))) {
      throw new LegacyProjectKeyIngestionOnlyError();
    }
  }

  #record(ask: LegacyKeyAsk, decision: LegacyProjectKeyUseDecision): void {
    const use: LegacyProjectKeyUse = {
      projectId: ask.project.id,
      organizationId: ask.project.organizationId,
      route: ask.route,
      permission: ask.permission,
      routeScopes: ask.routeScopes ?? [],
    };
    trace.getActiveSpan()?.setAttributes(legacyProjectKeyUseSpanAttributes({ use, decision }));
    const suppressed = this.window.claim({
      key: legacyProjectKeyUseWindowKey(use),
      now: this.now(),
    });
    if (suppressed === undefined) return;
    for (const line of legacyProjectKeyUseLines({ use, decision, suppressed })) {
      this.logger[line.level](line.fields, line.message);
    }
  }

  #target(project: LegacyKeyProject) {
    return {
      kind: "project",
      projectId: project.id,
      organizationId: project.organizationId,
    } as const;
  }
}
