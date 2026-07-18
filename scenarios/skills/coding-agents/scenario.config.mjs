import { defineConfig } from "@langwatch/scenario";
import { openai } from "@ai-sdk/openai";

export default defineConfig({
  defaultModel: { model: openai("gpt-5-mini") },
});
