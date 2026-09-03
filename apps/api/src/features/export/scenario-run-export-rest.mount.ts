/**
 * This process's composition of the packaged scenario run export REST family
 * (`@langwatch/scenario-server`).
 *
 * The family — the route, the streaming, the gzip pipe and the progress
 * broadcast — lives in the feature package (ADR-128). What lives here is
 * everything it dispatches through that is this process's: the browser
 * session, the permission probe, the audit sink, the export id and the fan-out
 * a watching browser subscribes to.
 *
 * The SESSION is what decides whether this family is mounted at all. A bulk
 * export lifts a project's whole run history — full mode includes every
 * conversation transcript — so it is attributable to a person by design, and a
 * process with no browser-session transport cannot name one. Such a process
 * leaves the family off rather than mounting a door that refuses every caller.
 */
import type { AppRestBroadcast, AppRestSecurity, MountableRestApp } from "@langwatch/api/rest";
import { generate } from "@langwatch/ksuid";
import {
  createScenarioRunExportRestApp,
  ScenarioRunExportForbiddenError,
  ScenarioRunExportService,
  ScenarioRunExportUnauthenticatedError,
} from "@langwatch/scenario-server";
import {
  scenarioRunExportRequestSchema,
  type ScenarioRunExportRequest,
  type SimulationService,
} from "@langwatch/scenario-contract";
import type { z } from "zod";

import type { ApiHandlerManagedSessionPort, HandlerManagedSession } from "../../app/api-handler-managed-session";

/**
 * The ksuid resource prefix an export id carries.
 *
 * STATED rather than imported: the resource catalogue that names it lives in
 * a browser package, and this is a persisted wire constant rather than a
 * decision — the browser subscribes to progress under exactly this id.
 */
const EXPORT_KSUID_RESOURCE = "export";

/** One completed export request, as the audit ledger records it. */
export type ScenarioRunExportAudit = (entry: {
  userId: string;
  projectId: string;
  action: "scenarioRuns.export";
  targetKind: "project";
  targetId: string;
  args: Record<string, unknown>;
}) => Promise<void>;

/** `/api/export/scenario-runs`, bound to one process's simulation store. */
export function mountScenarioRunExportRest(options: {
  security: AppRestSecurity;
  simulations: () => SimulationService;
  broadcast: () => AppRestBroadcast;
  session: ApiHandlerManagedSessionPort;
  recordExportRequested: ScenarioRunExportAudit;
}): MountableRestApp {
  // Explicit type arguments, not inferred. Every port below is a
  // context-sensitive arrow, so the session parameter is fixed before any of
  // them can supply a candidate.
  return createScenarioRunExportRestApp<
    ScenarioRunExportRequest,
    z.input<typeof scenarioRunExportRequestSchema>,
    HandlerManagedSession
  >({
    security: options.security,
    ports: {
      requestSchema: scenarioRunExportRequestSchema,
      resolveSession: (request) => options.session.resolve(request),
      probeProjectPermission: (session, projectId, permission) =>
        options.session.permitted({ session, projectId, permission }),
      recordExportRequested: options.recordExportRequested,
      exports: () => ScenarioRunExportService.create(options.simulations()),
      broadcast: options.broadcast,
      newExportId: () => generate(EXPORT_KSUID_RESOURCE).toString(),
      unauthenticatedError: () => new ScenarioRunExportUnauthenticatedError(),
      forbiddenError: (projectId) => new ScenarioRunExportForbiddenError(projectId),
    },
  }).hono;
}
