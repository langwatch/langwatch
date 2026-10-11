import { execFileSync } from "node:child_process";

import { expect, it } from "vitest";

import { generateExample } from "../src/api/codegen.ts";
import { operationSchema } from "../src/api/operation-schema.ts";

/** @scenario "Copy a request example" */
it("passes apostrophes and shell metacharacters as literal curl arguments", () => {
  const operation = operationSchema.parse({
    method: "POST",
    path: "/example",
    origin: "https://app.langwatch.ai",
    summary: "Example",
    description: "",
    deprecated: false,
    schemes: [],
    parameters: [
      {
        name: "X-Example",
        in: "header",
        required: false,
        deprecated: false,
        description: "",
        schema: { type: "string" },
      },
    ],
    body: { required: true, description: "", contents: [] },
    responses: [],
  });
  const body = JSON.stringify({ name: "O'Reilly", literal: '$(echo unsafe) `id` "$HOME"' });
  const header = 'O\'Reilly $(echo unsafe) "$HOME"';
  const example = generateExample({
    operation,
    language: "curl",
    state: { body, values: { "header:X-Example": header } },
  });
  const script = `curl() { for arg do printf '%s\\n' "$arg"; done; }\n${example}`;
  const argumentsReceived = execFileSync("sh", ["-c", script], { encoding: "utf8" }).split("\n");
  expect(argumentsReceived).toContain(body);
  expect(argumentsReceived).toContain(`X-Example: ${header}`);
  expect(argumentsReceived).toContain("https://app.langwatch.ai/example");
});
