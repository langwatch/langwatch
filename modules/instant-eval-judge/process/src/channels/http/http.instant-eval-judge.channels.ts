import {
  type InstantEvalJudgeServerConfig,
  isLangWatchJudgeHost,
} from "@langwatch/instant-eval-judge-contract";
import type { ScopedSecrets } from "@langwatch/secrets";

import { cloudClassifierKeyOf } from "../../rules/instant-eval-judge-cloud-key.rules.ts";
import { classifierApiKey } from "../instant-eval-classifier.channel.ts";
import { hostedDecisionsApiKey } from "../instant-eval-hosted-decisions.channel.ts";
import type { InstantEvalJudgeChannels } from "../instant-eval-judge.channels.ts";
import {
  llmJudgeAnthropicApiKey,
  llmJudgeOpenAiApiKey,
} from "../instant-eval-llm-judge.channel.ts";
import { HttpInstantEvalClassifierChannel } from "./http.instant-eval-classifier.channel.ts";
import { HttpInstantEvalDecisionModelChannel } from "./http.instant-eval-decision-model.channel.ts";
import { HttpInstantEvalHostedDecisionsChannel } from "./http.instant-eval-hosted-decisions.channel.ts";
import { HttpInstantEvalLlmJudgeChannel } from "./http.instant-eval-llm-judge.channel.ts";

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
    const isCloud = isLangWatchJudgeHost(config);
    const cloudKey = (apiKey: string | undefined) => cloudClassifierKeyOf({ isCloud, apiKey });
    const classifier = await secrets.into(classifierApiKey, (secretKey) => {
      const key = cloudKey(secretKey);
      if (!key.available) return void 0;
      return HttpInstantEvalClassifierChannel.create({
        apiKey: key.apiKey,
        ...(config.classifierBaseUrl ? { baseUrl: config.classifierBaseUrl } : {}),
        ...(config.classifierModel ? { model: config.classifierModel } : {}),
      });
    });
    const decisionModels = HttpInstantEvalDecisionModelChannel.create();
    const hostedDecisions = await secrets.into(hostedDecisionsApiKey, (secretKey) => {
      const key = cloudKey(secretKey);
      return key.available
        ? HttpInstantEvalHostedDecisionsChannel.create({ decisionModels, apiKey: key.apiKey })
        : void 0;
    });
    const anthropic = await secrets.into(llmJudgeAnthropicApiKey, (k) => cloudKey(k));
    const openAi = await secrets.into(llmJudgeOpenAiApiKey, (k) => cloudKey(k));
    const llmJudge = HttpInstantEvalLlmJudgeChannel.create({
      keys: {
        ...(anthropic.available ? { anthropic_messages: anthropic.apiKey } : {}),
        ...(openAi.available ? { openai_responses: openAi.apiKey } : {}),
      },
    });
    return { classifier, decisionModels, hostedDecisions, llmJudge };
  }
}
