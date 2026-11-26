import { isLangWatchJudgeModelId } from "@langwatch/model-provider-contract";

import type {
  ModelParamsResult,
  ScenarioModelParametersService,
} from "../../../services/scenario-model-parameters.service.ts";
import type { JudgePreviewModelParametersService } from "../../judge-preview/services/judge-preview-model-parameters.service.ts";

export type PreparedModels = {
  adapter: ModelParamsResult | undefined;
  simulator: ModelParamsResult;
  judge: ModelParamsResult;
};

/** The parameters each model of a run calls with, prepared side by side. */
export class ScenarioPrefetchModelsService {
  static create(options: {
    modelParameters: ScenarioModelParametersService;
    /** The judge's parameters when its model is LangWatch Judge (preview). */
    judgePreview: JudgePreviewModelParametersService;
  }): ScenarioPrefetchModelsService {
    return new ScenarioPrefetchModelsService(options.modelParameters, options.judgePreview);
  }

  private constructor(
    private readonly modelParameters: ScenarioModelParametersService,
    private readonly judgePreview: JudgePreviewModelParametersService,
  ) {}

  /** LangWatch Judge (preview) is this app's own endpoint; any other model is a provider's. */
  async prepare({
    projectId,
    models,
    runKey,
  }: {
    projectId: string;
    models: Readonly<{ adapter: string | undefined; simulator: string; judge: string }>;
    runKey: string;
  }): Promise<PreparedModels> {
    const [adapter, simulator, judge] = await Promise.all([
      models.adapter !== void 0
        ? this.modelParameters.prepare({ projectId, model: models.adapter })
        : Promise.resolve(void 0),
      this.modelParameters.prepare({ projectId, model: models.simulator }),
      isLangWatchJudgeModelId(models.judge)
        ? this.judgePreview.prepare({ projectId, runKey })
        : this.modelParameters.prepare({ projectId, model: models.judge }),
    ]);

    return { adapter, simulator, judge };
  }
}
