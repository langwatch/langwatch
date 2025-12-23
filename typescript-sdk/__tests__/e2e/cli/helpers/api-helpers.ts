import { type LangWatch } from "../../../../dist";
import { PROMPT_NAME_PREFIX } from "./constants";

export class ApiHelpers {
  constructor(private readonly langwatch: LangWatch) {}

  cleapUpTestPrompts = async () => {
    const prompts = await this.langwatch.prompts.getAll();
    const promises = prompts.map((prompt) => {
      if (prompt.handle?.startsWith(PROMPT_NAME_PREFIX)) {
        return this.langwatch.prompts.delete(prompt.handle);
      }
      return Promise.resolve();
    });
    await Promise.all(promises);
  };
}
