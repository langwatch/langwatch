/**
 * This process's composition of the scenario run export REST family (ADR-128).
 * A bulk export must be attributable to a person, so a process with no
 * browser-session transport leaves the family unmounted.
 */
import type { AppRestBroadcast, MountableRestApp, RestErrorHandler } from "@langwatch/api/rest";
import { generate } from "@langwatch/ksuid";
import {
  createScenarioRunExportRest,
  ScenarioRunExportForbiddenError,
  ScenarioRunExportService,
  ScenarioRunExportUnauthenticatedError,
} from "@langwatch/scenario-server";
import {
  scenarioRunExportRequestSchema,
  ScenarioApi,
  type ScenarioRunExportRequest,
  type SimulationService,
} from "@langwatch/scenario-contract";
import type { z } from "zod";

import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";
import type {
  ApiHandlerManagedSessionPort,
  HandlerManagedSession,
} from "../../app/api-handler-managed-session.ts";

/**
 * The ksuid resource prefix an export id carries, stated rather than
 * imported: the catalogue naming it lives in a browser package.
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
export function mountScenarioRunExportRest(
  runtime: ApiRestRuntime,
  options: {
    scenarios: () => ScenarioApi;
    simulations: () => SimulationService;
    broadcast: () => AppRestBroadcast;
    session: ApiHandlerManagedSessionPort;
    recordExportRequested: ScenarioRunExportAudit;
    errors: RestErrorHandler;
  },
): MountableRestApp {
  // Explicit type arguments, not inferred. Every port below is a
  // context-sensitive arrow, so the session parameter is fixed before any of
  // them can supply a candidate.
  const declaration = createScenarioRunExportRest<
    ScenarioRunExportRequest,
    z.input<typeof scenarioRunExportRequestSchema>,
    HandlerManagedSession
  >({
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
  });

  return runtime.mount(declaration, options.scenarios, { onError: options.errors });
}
