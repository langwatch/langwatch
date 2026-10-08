import type { InstantEvalJudgeServerConfig } from "@langwatch/instant-eval-judge-contract";
import type { ScopedSecrets } from "@langwatch/secrets";

import { cloudClassifierKeyOf } from "../../rules/instant-eval-judge-cloud-key.rules.ts";
import { classifierApiKey } from "../instant-eval-classifier.channel.ts";
import type { InstantEvalJudgeChannels } from "../instant-eval-judge.channels.ts";
import { HttpInstantEvalClassifierChannel } from "./http.instant-eval-classifier.channel.ts";

/** Classify calls go to LangWatch's cloud classifier, on LangWatch Cloud with its key only. */
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
      const apiKey = cloudClassifierKeyOf({ isCloud: config.isSaas, apiKey: secretKey });
      if (!apiKey) return void 0;
      return HttpInstantEvalClassifierChannel.create({
        apiKey,
        ...(config.classifierBaseUrl ? { baseUrl: config.classifierBaseUrl } : {}),
        ...(config.classifierModel ? { model: config.classifierModel } : {}),
      });
    });
    return { classifier };
  }
}
