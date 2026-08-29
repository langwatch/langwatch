/**
 * This process's composition of the packaged scenario run export REST family
 * (`@langwatch/scenario-server`).
 *
 * The family — the route, the streaming, the gzip pipe and the progress
 * broadcast — lives in the feature package (ADR-128). What lives here is
 * everything it dispatches through that is this process's: the REST security
 * spine, the request schema, the browser session, the permission probe, the
 * audit sink, the export id and the two refusals the client presentation
 * registry writes copy for.
 *
 * A factory rather than a module-level app, the way the trace export beside it
 * is built: the App is the one the transport root composed, never the module
 * singleton, so a second process (or a test) mounts the same family against a
 * different application without touching the family.
 */
import { createScenarioRunExportRestApp } from "@langwatch/scenario-server";
import { generate } from "@langwatch/ksuid";
import type { Hono } from "hono";

import { auditLog } from "~/runtime/app/features/audit-log";
import { appRestSecurity } from "~/server/api/security";
import type { App } from "~/server/app-layer/app";
import { probeProjectPermission } from "~/server/app-layer/permissions/imperative";
import { getServerAuthSession } from "~/server/auth";
import {
  ScenarioRunExportForbiddenError,
  ScenarioRunExportUnauthenticatedError,
} from "~/server/export/scenario-runs/errors";
import { scenarioRunExportRequestSchema } from "~/server/export/scenario-runs/types";
import type { NextRequest } from "~/types/next-stubs";
import { KSUID_RESOURCES } from "~/utils/constants";

/** `/api/export/scenario-runs`, bound to one process's application. */
export function createScenarioRunExportApp(app: App): Hono {
  return createScenarioRunExportRestApp({
    security: appRestSecurity,
    ports: {
      requestSchema: scenarioRunExportRequestSchema,
      resolveSession: (request) => getServerAuthSession({ app, req: request as NextRequest }),
      probeProjectPermission: (session, projectId, permission) =>
        probeProjectPermission({ session }, projectId, permission),
      recordExportRequested: (entry) => auditLog(entry),
      exports: () => app.simulationExports,
      broadcast: () => app.broadcast,
      newExportId: () => generate(KSUID_RESOURCES.EXPORT).toString(),
      unauthenticatedError: () => new ScenarioRunExportUnauthenticatedError(),
      forbiddenError: (projectId) => new ScenarioRunExportForbiddenError(projectId),
    },
  }).hono;
}
