/**
 * `/api/bug-reports` — over `runtime.mount`. Unauthenticated on purpose: the
 * one fact this door binds only enriches a report with a project link where
 * the caller happened to present a credential, and is never a gate.
 */
import { bindRestMiddleware, type MountableRestApp } from "@langwatch/api/rest";
import { bugReportCredential, opsBugReportRest } from "@langwatch/ops-server";

import { extractApiKeyRequestCredentials } from "../../app/api-key-request-credentials.ts";
import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";
import type { BugReportRestPorts } from "./bug-report-rest.ports.ts";

/** Mounts `/api/bug-reports` with the optional project credential as a fact. */
export function mountBugReportRest(
  runtime: ApiRestRuntime,
  ports: BugReportRestPorts,
): MountableRestApp {
  return runtime.mount(opsBugReportRest.router(), ports.ops, {
    facts: [
      bindRestMiddleware(bugReportCredential, (context) =>
        extractApiKeyRequestCredentials(context.req.raw),
      ),
    ],
  });
}
