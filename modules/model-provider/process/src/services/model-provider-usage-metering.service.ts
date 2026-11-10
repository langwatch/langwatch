/**
 * Writes the usage of every platform call on stored credentials to the gateway spend ledger
 * (ADR-193). Best effort: the provider already billed the call, so a ledger failure is logged
 * with every figure and never fails the generation.
 */
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import { type LanguageModelMiddleware, wrapLanguageModel } from "ai";

import type { ModelProviderSpend } from "../channels/model-provider.channels.ts";
import {
  type MeterableModel,
  type ProviderCallUsage,
  type ProviderStreamPart,
  isBilledUsage,
  vercelSpendUsageOf,
} from "../rules/vercel-provider-usage.rules.ts";

const logger = createLogger("langwatch:model-provider:usage-metering");

/** The ledger's request type for calls LangWatch features make through the execution proxy. */
const PLATFORM_REQUEST_TYPE = "platform";

type MeteredCall = Readonly<{
  projectId: string;
  /** The registry model id, provider prefixed. */
  model: string;
  modelProviderId: string;
  /** What asked for the call, kept in the request id for reading the ledger. */
  featureKey: string;
}>;

export class ModelProviderUsageMeteringService {
  static create(input: {
    spend: ModelProviderSpend | undefined;
  }): ModelProviderUsageMeteringService {
    return new ModelProviderUsageMeteringService(input.spend);
  }

  private constructor(private readonly spend: ModelProviderSpend | undefined) {}

  /** The same model, writing each answered call's usage to the ledger. */
  metered(model: MeterableModel, call: MeteredCall): MeterableModel {
    if (!this.spend) return model;
    return wrapLanguageModel({ model, middleware: this.middleware(call) });
  }

  private middleware(call: MeteredCall): LanguageModelMiddleware {
    return {
      specificationVersion: "v3",
      wrapGenerate: async ({ doGenerate }) => {
        const startedAt = performance.now();
        const result = await doGenerate();
        await this.record({
          call,
          usage: result.usage,
          responseId: result.response?.id,
          startedAt,
        });
        return result;
      },
      wrapStream: async ({ doStream }) => {
        const startedAt = performance.now();
        const result = await doStream();
        let responseId: string | undefined;
        let usage: ProviderCallUsage | undefined;
        const observe = new TransformStream<ProviderStreamPart, ProviderStreamPart>({
          transform: (part, controller) => {
            if (part.type === "response-metadata" && part.id) responseId = part.id;
            if (part.type === "finish") usage = part.usage;
            controller.enqueue(part);
          },
          flush: () => this.record({ call, usage, responseId, startedAt }),
        });
        return { ...result, stream: result.stream.pipeThrough(observe) };
      },
    };
  }

  private async record({
    call,
    usage,
    responseId,
    startedAt,
  }: {
    call: MeteredCall;
    usage: ProviderCallUsage | undefined;
    responseId: string | undefined;
    startedAt: number;
  }): Promise<void> {
    const quantities = vercelSpendUsageOf(usage);
    if (!isBilledUsage(quantities) || !this.spend) return;
    const key = responseId ?? generate("platformcall").toString();
    const entry = {
      requestId: `${PLATFORM_REQUEST_TYPE}:${call.featureKey}:${key}`,
      projectId: call.projectId,
      model: call.model,
      ...(call.modelProviderId ? { modelProviderId: call.modelProviderId } : {}),
      requestType: PLATFORM_REQUEST_TYPE,
      usage: quantities,
      durationMs: performance.now() - startedAt,
      occurredAt: nowInstant().epochMilliseconds,
    };
    try {
      const { status } = await this.spend.recordProviderUsage(entry);
      if (status !== "recorded") {
        logger.error({ ...entry, status }, "platform call usage not written to the ledger");
      }
    } catch (error) {
      logger.error({ ...entry, error }, "platform call usage not written to the ledger");
    }
  }
}
