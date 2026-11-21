import { createLogger } from "@langwatch/observability";
import type { ProjectApi } from "@langwatch/project-contract";

import type { LwqlKeyMapRow } from "../features/provisioning/services/langwatch-ql-production-provisioning.service.ts";
import type { LangWatchQLConnection } from "../repositories/langwatch-ql-executor.repository.ts";
import type { LwqlKeyMapRepository } from "../repositories/langwatch-ql-key-map.repository.ts";
import { LangWatchQLCapabilityService } from "./langwatch-ql-capability.service.ts";

const lwqlCapability = LangWatchQLCapabilityService.create();

const logger = createLogger("langwatch:lwql-key-map-service");

/** Where the rows go: the restricted identity's names, the key-map database, and the writer. */
type LwqlKeyMapTarget = Readonly<{
  connection: LangWatchQLConnection;
  /** Writes through the LangWatchQL admin target only (ADR-200). */
  repository: LwqlKeyMapRepository;
  /** The app's own ClickHouse database, which holds the key map (migration 00084). */
  sourceDatabase: string;
}>;

/**
 * A project's LangWatchQL key-map row. `syncProject` writes it as the reaction to project's
 * created event (ARCHITECTURE §9); a duplicate pair is harmless, and a failed insert throws so
 * the queue retries. `ensureProject` checks for the row before a read and heals a missing one.
 */
export class LwqlKeyMapService {
  private constructor(
    private readonly deps: {
      projects: Pick<ProjectApi, "findById">;
      /** Absent where the deployment offers no LangWatchQL. */
      target?: LwqlKeyMapTarget;
    },
  ) {}

  static create(options: {
    projects: Pick<ProjectApi, "findById">;
    target?: LwqlKeyMapTarget;
  }): LwqlKeyMapService {
    return new LwqlKeyMapService(options);
  }

  /** Nothing to write without LangWatchQL, for a deleted project, or for an empty key. */
  async syncProject(input: { projectId: string }): Promise<void> {
    const { target, projects } = this.deps;
    if (!target) return;

    const project = await projects.findById(input.projectId);
    if (!project) return;
    if (!project.lwqlKey) {
      logger.error(
        { projectId: project.id },
        "new project has an empty lwqlKey — cannot sync its LangWatchQL key-map row",
      );
      return;
    }

    const row: LwqlKeyMapRow = {
      KeyHash: lwqlCapability.tenantCapability({ secret: project.lwqlKey }),
      TenantId: project.id,
    };
    await target.repository.insertRow({ row, sourceDatabase: target.sourceDatabase });
  }

  /**
   * Whether the project's key-map row is there to read through, writing it first when missing.
   * False, never a throw, when it cannot be: a read without the row sees zero rows, not an error.
   */
  async ensureProject(input: { projectId: string }): Promise<boolean> {
    const { target, projects } = this.deps;
    if (!target) return false;

    try {
      const project = await projects.findById(input.projectId);
      if (!project?.lwqlKey) return false;

      const row: LwqlKeyMapRow = {
        KeyHash: lwqlCapability.tenantCapability({ secret: project.lwqlKey }),
        TenantId: project.id,
      };
      const hashes = await target.repository.findKeyHashes({
        tenantId: project.id,
        sourceDatabase: target.sourceDatabase,
      });
      if (hashes.includes(row.KeyHash)) return true;

      await target.repository.insertRow({ row, sourceDatabase: target.sourceDatabase });
      logger.warn({ projectId: project.id }, "wrote a missing LangWatchQL key-map row");
      return true;
    } catch (error) {
      logger.error(
        { projectId: input.projectId, error },
        "could not ensure the project's LangWatchQL key-map row",
      );
      return false;
    }
  }
}
