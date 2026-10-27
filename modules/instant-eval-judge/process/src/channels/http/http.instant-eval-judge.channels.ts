import {
  type InstantEvalJudgeServerConfig,
  isLangWatchJudgeHost,
} from "@langwatch/instant-eval-judge-contract";
import type { ScopedSecrets } from "@langwatch/secrets";

import { cloudClassifierKeyOf } from "../../rules/instant-eval-judge-cloud-key.rules.ts";
import { classifierApiKey } from "../instant-eval-classifier.channel.ts";
import type { InstantEvalJudgeChannels } from "../instant-eval-judge.channels.ts";
import { HttpInstantEvalClassifierChannel } from "./http.instant-eval-classifier.channel.ts";
import { HttpInstantEvalDecisionModelChannel } from "./http.instant-eval-decision-model.channel.ts";

/** Classify calls go to LangWatch's classifier with its key, where LangWatch runs the install. */
export class HttpInstantEvalJudgeChannels {
  static readonly requires = [] as const;

  static async create({
    config,
    secrets,
  }: {
    config: InstantEvalJudgeServerConfig;
    secrets: ScopedSecrets;
  }): Promise<InstantEvalJudgeChannels> {
    const classifier = await secrets.into(classifierApiKey, (secretKey) => {
      const key = cloudClassifierKeyOf({
        isCloud: isLangWatchJudgeHost(config),
        apiKey: secretKey,
      });
      if (!key.available) return void 0;
      return HttpInstantEvalClassifierChannel.create({
        apiKey: key.apiKey,
        ...(config.classifierBaseUrl ? { baseUrl: config.classifierBaseUrl } : {}),
        ...(config.classifierModel ? { model: config.classifierModel } : {}),
      });
    });
    return { classifier, decisionModels: HttpInstantEvalDecisionModelChannel.create() };
  }
}
