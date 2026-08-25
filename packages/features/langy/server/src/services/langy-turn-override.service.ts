import {
  LANGY_PROMPT_HANDLES,
  resolveLangyPrompt,
  type LangyPromptPort,
} from "./langy-prompt-registry.service";
import { LANGY_OVERRIDE } from "./langy-turn.shared";

export type LangyTurnOverride = {
  text: string;
  source: "unconfigured" | "registry" | "cached" | "fallback";
};

/** Private, process-held prompt override policy. */
export class LangyTurnOverrideService {
  private static lastRegistryOverrideText: string | null = null;

  private constructor(
    private readonly prompts: LangyPromptPort | undefined,
    private readonly projectId: string | undefined,
  ) {}

  static create(input: {
    prompts: LangyPromptPort | undefined;
    projectId: string | undefined;
  }): LangyTurnOverrideService {
    return new LangyTurnOverrideService(input.prompts, input.projectId);
  }

  async resolve(): Promise<LangyTurnOverride> {
    if (!this.projectId || !this.prompts) {
      return { text: LANGY_OVERRIDE, source: "unconfigured" };
    }
    const resolved = await resolveLangyPrompt({
      promptService: this.prompts,
      projectId: this.projectId,
      handle: LANGY_PROMPT_HANDLES.turnOverride,
      fallback: LANGY_OVERRIDE,
    });
    if (resolved.source === "registry") {
      LangyTurnOverrideService.lastRegistryOverrideText = resolved.text;
      return { text: resolved.text, source: "registry" };
    }
    if (
      resolved.source === "error" &&
      LangyTurnOverrideService.lastRegistryOverrideText !== null
    ) {
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
