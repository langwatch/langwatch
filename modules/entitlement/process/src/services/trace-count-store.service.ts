import type {
  FoldProjectionStore,
  FoldStateRead,
  ProjectionStoreContext,
} from "@langwatch/eventing";
import { createLogger, type Logger } from "@langwatch/observability";

import type { TenancyRepository } from "../repositories/tenancy.repository.ts";
import type {
  TraceCountRepository,
  TraceCountState,
} from "../repositories/trace-count.repository.ts";
import { traceCountOf } from "../rules/trace-count.rules.ts";

const defaultLogger = createLogger("langwatch:usage:traceCount");

/**
 * The trace count fold's store: keyed `<project>:<month>`, written under the project's
 * organization. A project in no organization is counted nowhere, loudly.
 */
export class TraceCountStoreService implements FoldProjectionStore<TraceCountState> {
  private constructor(
    private readonly counts: TraceCountRepository,
    private readonly projects: Pick<TenancyRepository, "getProjectPlacement">,
    private readonly logger: Pick<Logger, "warn">,
  ) {}

  static create({
    counts,
    projects,
    logger = defaultLogger,
  }: {
    counts: TraceCountRepository;
    projects: Pick<TenancyRepository, "getProjectPlacement">;
    logger?: Pick<Logger, "warn">;
  }): TraceCountStoreService {
    return new TraceCountStoreService(counts, projects, logger);
  }

  /** The fold's key: one count per project and UTC month. */
  static keyOf({ projectId, month }: { projectId: string; month: string }): string {
    return `${projectId}:${month}`;
  }

  async get(key: string, context: ProjectionStoreContext): Promise<FoldStateRead<TraceCountState>> {
    const { state } = await this.getWithApplied(key, context);
    return state ? { kind: "folded", state } : { kind: "empty" };
  }

  async getWithApplied(
    key: string,
    context: ProjectionStoreContext,
  ): Promise<{ state: TraceCountState | null; appliedEventIds: string[]; miss?: "absent" }> {
    const projectId = String(context.tenantId);
    const placement = await this.projects.getProjectPlacement({ projectId });
    if (placement.kind === "unplaced") return { state: null, appliedEventIds: [], miss: "absent" };
    const [stored] = await this.counts.find({
      organizationId: placement.organizationId,
      projectId,
      month: key.slice(key.lastIndexOf(":") + 1),
    });
    if (!stored) return { state: null, appliedEventIds: [], miss: "absent" };
    return { state: stored.state, appliedEventIds: [...stored.appliedEventIds] };
  }

  async store(state: TraceCountState, context: ProjectionStoreContext): Promise<void> {
    const placement = await this.projects.getProjectPlacement({ projectId: state.projectId });
    if (placement.kind === "unplaced") {
      this.logger.warn(
        { projectId: state.projectId },
        "orphan project has no organization, trace not counted",
      );
      return;
    }
    await this.counts.save({
      organizationId: placement.organizationId,
      state,
      traces: traceCountOf(state),
      appliedEventIds: context.appliedEventIds ?? [],
    });
  }
}
