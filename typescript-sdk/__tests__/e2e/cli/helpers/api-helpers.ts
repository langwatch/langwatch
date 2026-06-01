import { type LangWatch } from "../../../../dist";
import { PROMPT_NAME_PREFIX } from "./constants";

export class ApiHelpers {
  constructor(private readonly langwatch: LangWatch) {}

  /**
   * Delete test prompts and surface deletion errors.
   *
   * When `handles` is omitted, deletes every prompt starting with
   * PROMPT_NAME_PREFIX. **Avoid the prefix path in parallel test files** —
   * vitest runs e2e files in parallel, and a prefix-wide cleanup in one
   * file's afterAll will delete prompts another file is still using.
   * Prefer passing the per-file set of handles you actually created.
   */
  cleanUpTestPrompts = async (handles?: string[]) => {
    const targets =
      handles ??
      (await this.langwatch.prompts.getAll())
        .map((p) => p.handle)
        .filter((h): h is string => !!h && h.startsWith(PROMPT_NAME_PREFIX));
    const results = await Promise.allSettled(
      targets.map((h) => this.langwatch.prompts.delete(h)),
    );
    const failures = results
      .map((r, i) => ({ r, handle: targets[i] }))
      .filter(({ r }) => r.status === "rejected");
    if (failures.length > 0) {
      const detail = failures
        .map(
          ({ r, handle }) =>
            `${handle}: ${(r as PromiseRejectedResult).reason}`,
        )
        .join("; ");
      throw new Error(
        `cleanUpTestPrompts: ${failures.length} prompt deletion(s) failed: ${detail}`,
      );
    }
  };
}
