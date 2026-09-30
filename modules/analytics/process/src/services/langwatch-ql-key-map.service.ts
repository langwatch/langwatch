import { createLogger } from "@langwatch/observability";
import type { ProjectApi } from "@langwatch/project-contract";

import type { LangWatchQLConnection } from "../repositories/langwatch-ql-executor.repository.ts";
import type { LwqlKeyMapRepository } from "../repositories/langwatch-ql-key-map.repository.ts";
import { LangWatchQLCapabilityService } from "./langwatch-ql-capability.service.ts";
import {
  LangWatchQLProductionProvisioningService,
  type LwqlKeyMapRow,
} from "./langwatch-ql-production-provisioning.service.ts";

const lwqlProvisioning = LangWatchQLProductionProvisioningService.create();

const lwqlCapability = LangWatchQLCapabilityService.create();

const logger = createLogger("langwatch:lwql-key-map-service");

/** Where the rows go: the restricted identity's names, and the database the approved views read. */
export type LwqlKeyMapTarget = Readonly<{
  connection: LangWatchQLConnection;
  /** The app's own ClickHouse database, which holds the key map (migration 00084). */
  sourceDatabase: string;
}>;

/**
 * Writes a new project's LangWatchQL key-map row, analytics' reaction to project's created event
 * (ARCHITECTURE §9). A duplicate (KeyHash, TenantId) pair is harmless to the row policy, so a
 * redelivery writes again; a failed insert throws so the queue retries it.
 */
export class LwqlKeyMapService {
  private constructor(
    private readonly deps: {
      repository: LwqlKeyMapRepository;
      projects: Pick<ProjectApi, "findById">;
      /** Absent where the deployment offers no LangWatchQL. */
      target?: LwqlKeyMapTarget;
    },
  ) {}

  static create(options: {
    repository: LwqlKeyMapRepository;
    projects: Pick<ProjectApi, "findById">;
    target?: LwqlKeyMapTarget;
  }): LwqlKeyMapService {
    return new LwqlKeyMapService(options);
  }

  /** Nothing to write without LangWatchQL, for a deleted project, or for an empty key. */
  async syncProject(input: { projectId: string }): Promise<void> {
    const { target, projects, repository } = this.deps;
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
    await repository.insertRow({
      table: lwqlProvisioning.keyMapTableQualifiedName({
        names: lwqlProvisioning.names({ connection: target.connection }),
        sourceDatabase: target.sourceDatabase,
      }),
      row,
    });
  }
}
