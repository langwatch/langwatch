import type {
  LangyPanelCall,
  langyProjectInputSchema,
  langySetModelsAllowedInputSchema,
} from "@langwatch/langy-contract";

import type { LangyService } from "../../../services/langy.service.ts";
import type { LangyPanelAccessService } from "./langy-panel-access.service.ts";

type LangyModels = Pick<LangyService, "findModelsAllowedForProject" | "setModelsAllowedForProject">;

/**
 * The models Langy may run on in a project, as the composer and the settings page read and
 * replace them. Null is every model. Spec: specs/langy/langy-model-allowlist.feature
 */
export class LangyPanelModelsService {
  static create(members: {
    access: LangyPanelAccessService;
    langy: LangyModels;
  }): LangyPanelModelsService {
    return new LangyPanelModelsService(members.access, members.langy);
  }

  private constructor(
    private readonly access: LangyPanelAccessService,
    private readonly langy: LangyModels,
  ) {}

  async getModelsAllowed(
    input: LangyPanelCall<typeof langyProjectInputSchema>,
  ): Promise<{ modelsAllowed: string[] | null }> {
    await this.access.assertPanelAccess(input);
    return { modelsAllowed: await this.langy.findModelsAllowedForProject(input.projectId) };
  }

  /** An empty list allows every model again. */
  async setModelsAllowed(
    input: LangyPanelCall<typeof langySetModelsAllowedInputSchema>,
  ): Promise<{ modelsAllowed: string[] | null }> {
    await this.access.assertPanelAccess(input);
    const modelsAllowed = await this.langy.setModelsAllowedForProject({
      projectId: input.projectId,
      actorUserId: input.caller.userId,
      modelsAllowed: input.modelsAllowed,
    });
    return { modelsAllowed };
  }
}
