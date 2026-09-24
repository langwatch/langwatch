import { createLogger } from "@langwatch/observability";

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

  /** Best effort, as project creation always treated it: the first chat mints the key again. */
  async provision(input: {
    projectId: string;
    organizationId: string;
    actorUserId: string;
  }): Promise<void> {
    try {
      await this.virtualKeys.provision(input);
    } catch (error) {
      logger.error(
        { error, projectId: input.projectId, context: "provisionVirtualKey:project.create" },
        "Langy virtual key provisioning failed; the first chat provisions it again.",
      );
    }
  }
}
