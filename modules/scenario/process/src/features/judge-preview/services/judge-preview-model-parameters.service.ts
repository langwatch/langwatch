/**
 * The scenario judge's model parameters when the judge is LangWatch Judge (preview): an
 * OpenAI-shaped endpoint on this app, called with the run's own key, so neither runner changes.
 * @see modules/scenario/specs/judge-preview.feature
 */
import {
  JUDGE_PREVIEW_API_BASE_PATH,
  JUDGE_PREVIEW_LITELLM_MODEL,
} from "@langwatch/scenario-contract";

import type { ModelParamsResult } from "../../../services/scenario-model-parameters.service.ts";
import type { JudgePreviewAvailabilityService } from "./judge-preview-availability.service.ts";

const NO_ENDPOINT =
  "LangWatch Judge (preview) needs this installation's own address to be configured, so it cannot judge here. Pick another judge model.";

export class JudgePreviewModelParametersService {
  static create(deps: {
    availability: JudgePreviewAvailabilityService;
    /** The address the run's child reaches this app at, as it does for its own events. */
    langwatchEndpoint: string;
  }): JudgePreviewModelParametersService {
    return new JudgePreviewModelParametersService(deps.availability, deps.langwatchEndpoint);
  }

  private constructor(
    private readonly availability: JudgePreviewAvailabilityService,
    private readonly langwatchEndpoint: string,
  ) {}

  /** Refused before the run starts where the judge may not answer, with what to do instead. */
  async prepare({
    projectId,
    runKey,
  }: {
    projectId: string;
    runKey: string;
  }): Promise<ModelParamsResult> {
    const availability = await this.availability.availabilityFor({ projectId });
    if (!availability.isAvailable) {
      return { success: false, reason: "provider_not_enabled", message: availability.message };
    }
    const base = this.langwatchEndpoint.replace(/\/+$/, "");
    if (!base) return { success: false, reason: "missing_params", message: NO_ENDPOINT };
    return {
      success: true,
      params: {
        model: JUDGE_PREVIEW_LITELLM_MODEL,
        api_base: `${base}${JUDGE_PREVIEW_API_BASE_PATH}`,
        api_key: runKey,
      },
    };
  }
}
