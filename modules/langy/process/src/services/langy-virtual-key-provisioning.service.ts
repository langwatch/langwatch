import { createLogger } from "@langwatch/observability";
import type { ProjectCreatedEventData } from "@langwatch/project-contract";

import type { LangyVirtualKeyService } from "./langy-credential.service.ts";

const logger = createLogger("langwatch:langy:virtual-key");

/** A new project's gateway key, minted ahead of its first chat so it is listed from day one. */
export class LangyVirtualKeyProvisioningService {
  private constructor(private readonly virtualKeys: LangyVirtualKeyService) {}

  static create(input: {
    virtualKeys: LangyVirtualKeyService;
  }): LangyVirtualKeyProvisioningService {
    return new LangyVirtualKeyProvisioningService(input.virtualKeys);
  }

  /**
   * Only a project somebody created, as main minted on the create request alone. Best effort, as
   * creation always treated it: the first chat mints the key again, so a failure is not retried.
   */
  async provisionCreated(created: ProjectCreatedEventData): Promise<void> {
    if (created.backfilled || !created.createdByUserId) return;

    try {
      await this.virtualKeys.provision({
        projectId: created.projectId,
        organizationId: created.organizationId,
        actorUserId: created.createdByUserId,
      });
    } catch (error) {
      logger.error(
        { error, projectId: created.projectId, context: "provisionVirtualKey:project.create" },
        "Langy virtual key provisioning failed; the first chat provisions it again.",
      );
    }
  }
}
