/**
 * Binds the `/api/unsubscribe` REST declaration to this process's own root
 * (RFC 8058, ADR-031). The caller address is resolved off this process's own
 * client-address chain, the same one every other public door reads.
 */
import type { AutomationApi } from "@langwatch/automation-contract";
import {
  unsubscribeCallerAddress,
  unsubscribeRest,
  unsubscribeRestErrors,
} from "@langwatch/automation-server";
import { bindRestMiddleware, type MountableRestApp } from "@langwatch/api/rest";

import { apiClientAddress } from "../../app/api-client-address.ts";
import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";

/** Mounts `/api/unsubscribe`, bound to this process's installed automation application. */
export function mountUnsubscribeRest(
  runtime: ApiRestRuntime,
  options: Readonly<{ automation: () => AutomationApi }>,
): MountableRestApp {
  return runtime.mount(unsubscribeRest.router(), options.automation, {
    onError: unsubscribeRestErrors,
    facts: [bindRestMiddleware(unsubscribeCallerAddress, (context) => apiClientAddress(context) ?? null)],
  });
}
