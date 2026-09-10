/**
 * Binds the `/api/triggers` and `/api/trigger/slack` REST declarations to this
 * process's own root. Both dispatch through the SAME automation application.
 */
import type { AutomationApi } from "@langwatch/automation-contract";
import {
  createAutomationRest,
  slackAutomationRest,
  slackAutomationRestErrors,
} from "@langwatch/automation-server";
import type { MountableRestApp, PlatformUrlBuilder } from "@langwatch/api/rest";

import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";

/** Mounts `/api/triggers` and its `/api/trigger/slack` sibling. */
export function mountTriggersRest(
  runtime: ApiRestRuntime,
  options: Readonly<{ automation: () => AutomationApi; platformUrl: PlatformUrlBuilder }>,
): MountableRestApp[] {
  return [
    runtime.mount(createAutomationRest(options.platformUrl).router(), options.automation),
    runtime.mount(slackAutomationRest.router(), options.automation, {
      onError: slackAutomationRestErrors,
    }),
  ];
}
