import { LANGY_PROMPT_HANDLES } from "@langwatch/langy-contract";
import { LangyPromptRegistryService, type LangyPrompt } from "./langy-prompt-registry.service.ts";
import { LANGY_OVERRIDE } from "./langy-turn-shared.service.ts";

export type LangyTurnOverride = {
  text: string;
  source: "unconfigured" | "registry" | "cached" | "fallback";
};

/** Private, process-held prompt override policy. */
export class LangyTurnOverrideService {
  private static lastRegistryOverrideText: string | null = null;

  private constructor(
    private readonly prompts: LangyPrompt | undefined,
    private readonly projectId: string | undefined,
  ) {}

  static create(input: {
    prompts: LangyPrompt | undefined;
    projectId: string | undefined;
  }): LangyTurnOverrideService {
    return new LangyTurnOverrideService(input.prompts, input.projectId);
  }

  async resolve(): Promise<LangyTurnOverride> {
    if (!this.projectId || !this.prompts) {
      return { text: LANGY_OVERRIDE, source: "unconfigured" };
    }

    const resolved = await LangyPromptRegistryService.create({ prompts: this.prompts }).resolve({
      projectId: this.projectId,
      handle: LANGY_PROMPT_HANDLES.turnOverride,
      fallback: LANGY_OVERRIDE,
    });
    if (resolved.source === "registry") {
      LangyTurnOverrideService.lastRegistryOverrideText = resolved.text;

      return { text: resolved.text, source: "registry" };
    }

    if (resolved.source === "error" && LangyTurnOverrideService.lastRegistryOverrideText !== null) {
      return {
        text: LangyTurnOverrideService.lastRegistryOverrideText,
        source: "cached",
      };
    }

    if (resolved.source !== "error") {
      LangyTurnOverrideService.lastRegistryOverrideText = null;
    }

    return { text: resolved.text, source: "fallback" };
  }
}
