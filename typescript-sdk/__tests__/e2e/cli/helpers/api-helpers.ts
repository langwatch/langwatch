import { type LangWatch } from "../../../../dist";
import { PROMPT_NAME_PREFIX } from "./constants";

export class ApiHelpers {
  constructor(private readonly langwatch: LangWatch) {}

  cleapUpTestPrompts = async () => {
    const prompts = await this.langwatch.prompts.getAll();
    const targets = prompts.filter((p) =>
      p.handle?.startsWith(PROMPT_NAME_PREFIX),
    );
    const results = await Promise.allSettled(
      targets.map((p) => this.langwatch.prompts.delete(p.handle!)),
    );
    const failures = results
      .map((r, i) => ({ r, handle: targets[i]?.handle }))
      .filter(({ r }) => r.status === "rejected");
    if (failures.length > 0) {
      const detail = failures
        .map(
          ({ r, handle }) =>
            `${handle}: ${(r as PromiseRejectedResult).reason}`,
        )
        .join("; ");
      throw new Error(
        `cleapUpTestPrompts: ${failures.length} prompt deletion(s) failed: ${detail}`,
      );
    }
  };
}
