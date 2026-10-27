import type { LanguageModelV3 } from "@ai-sdk/provider";
import { MockLanguageModelV3 } from "ai/test";

import type { LitellmModelChannel, LitellmModelInput } from "../litellm-model.channel.ts";

type ModelRequest = LitellmModelInput & { role: "model" | "judge" };

/** Models that never leave the process: each call records its input and answers a mock model. */
export class MemoryLitellmModelChannel implements LitellmModelChannel {
  static create(): MemoryLitellmModelChannel {
    return new MemoryLitellmModelChannel();
  }

  readonly requested: ModelRequest[] = [];

  private constructor() {}

  model(input: LitellmModelInput): LanguageModelV3 {
    this.requested.push({ ...input, role: "model" });
    return new MockLanguageModelV3({ modelId: input.litellmParams.model });
  }

  judgeModel(input: LitellmModelInput): LanguageModelV3 {
    this.requested.push({ ...input, role: "judge" });
    return new MockLanguageModelV3({ modelId: input.litellmParams.model });
  }
}
