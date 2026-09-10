/**
 * Binds the `/api/prompts` REST declaration to this process's own root. Routes,
 * schemas and OpenAPI live in the feature package (ADR-128); this only names
 * the runtime the family mounts on.
 */
import type { MountableRestApp } from "@langwatch/api/rest";
import type { PromptApi } from "@langwatch/prompt-contract";
import { promptRest } from "@langwatch/prompt-server";

import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";

/** Mounts `/api/prompts`, bound to one process's installed prompt application. */
export function mountPromptsRest(
  runtime: ApiRestRuntime,
  options: Readonly<{ prompts: () => PromptApi }>,
): MountableRestApp {
  return runtime.mount(promptRest.router(), options.prompts);
}
