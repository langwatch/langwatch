/**
 * Langy prompt registry loader. WIRED for the per-turn override only.
 * WHERE the row lives is a deployment decision (see ADR-050): a prompt row
 */

import { createLogger } from "@langwatch/observability";
import { LANGY_PROMPT_DEFAULT_TAG, type LangyPromptHandle } from "@langwatch/langy-contract";

const logger = createLogger("langwatch:langy:prompt-registry");

/** Narrow technical port over the external Prompt feature. */
export abstract class LangyPromptPort {
  abstract tryGetPromptByIdOrHandle(input: {
    idOrHandle: string;
    projectId: string;
    tag: string;
  }): Promise<{ prompt: string } | null>;
}

export interface ResolveLangyPromptParams {
  /** The project that HOLDS the Langy registry rows (the internal system project). */
  projectId: string;
  /** One of `LANGY_PROMPT_HANDLES`. */
  handle: LangyPromptHandle;
  /** In-repo copy used verbatim on any miss/empty/error. Never allowed to be empty. */
  fallback: string;
  /** Tag to pin (defaults to `production`); pass `"latest"` to read the newest draft. */
  tag?: string;
}

export interface ResolvedLangyPrompt {
  text: string;
  /**
   * Which path produced `text`: - `registry` — a promoted row was read. - `fallback` — a GENUINE
   * miss: no row, or a row whose prompt is empty.
   */
  source: "registry" | "fallback" | "error";
}

export class LangyPromptRegistryService {
  static create(options: { prompts: LangyPromptPort }): LangyPromptRegistryService {
    return new LangyPromptRegistryService(options);
  }

  private readonly prompts: LangyPromptPort;

  private constructor(options: { prompts: LangyPromptPort }) {
    this.prompts = options.prompts;
  }

  /**
   * Resolve a Langy prompt from the registry, falling back to the in-repo copy. NEVER throws.
   */
  async resolve(params: ResolveLangyPromptParams): Promise<ResolvedLangyPrompt> {
    const { projectId, handle, fallback } = params;
    const tag = params.tag ?? LANGY_PROMPT_DEFAULT_TAG;

    try {
      const versioned = await this.prompts.tryGetPromptByIdOrHandle({
        idOrHandle: handle,
        projectId,
        tag,
      });
      const text = versioned?.prompt?.trim();
      if (text) {
        return { text: versioned!.prompt, source: "registry" };
      }

      logger.warn(
        { handle, projectId, tag },
        "langy prompt registry row missing or empty — using in-repo fallback",
      );
    } catch (error) {
      logger.warn(
        { error, handle, projectId, tag },
        "langy prompt registry read failed — using in-repo fallback",
      );

      return { text: fallback, source: "error" };
    }

    return { text: fallback, source: "fallback" };
  }
}
