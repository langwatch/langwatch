import { type LangWatch } from "../../../../dist";
import { PROMPT_NAME_PREFIX } from "./constants";

export class ApiHelpers {
  constructor(private readonly langwatch: LangWatch) {}

  /**
   * Delete test prompts. Omitting `handles` deletes every PROMPT_NAME_PREFIX
   * match -- avoid this in parallel e2e files, since one file's cleanup can
   * delete prompts another file still uses. Pass explicit handles instead.
   */
  cleanUpTestPrompts = async (handles?: string[]) => {
    const targets =
      handles ??
      (await this.langwatch.prompts.getAll())
        .map((p) => p.handle)
        .filter((h): h is string => !!h && h.startsWith(PROMPT_NAME_PREFIX));
    const results = await Promise.allSettled(targets.map((h) => this.langwatch.prompts.delete(h)));
    const failures = results
      .map((r, i) => ({ r, handle: targets[i] }))
      .filter(({ r }) => r.status === "rejected");
    if (failures.length > 0) {
      const detail = failures
        .map(({ r, handle }) => `${handle}: ${(r as PromiseRejectedResult).reason}`)
        .join("; ");
      throw new Error(
        `cleanUpTestPrompts: ${failures.length} prompt deletion(s) failed: ${detail}`,
      );
    }
  };
}
