/**
 * Binds the legacy evaluation REST declaration to this process's project
 * door. The declaration is already the whole family — the catalogue, the
 * batch log and the four evaluate paths — over the one `EvaluationApi` this
 * process composes, so the mount asks for no fact and adds no middleware.
 */
import type { MountableRestApp } from "@langwatch/api/rest";
import { evaluationsLegacyRest } from "@langwatch/evaluation-server";
import type { EvaluationApi } from "@langwatch/evaluation-contract";

import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";

/** Mounts `/api/evaluations` and its `/api/v1` twin behind the project door. */
export function mountEvaluationsLegacyRest(
  runtime: ApiRestRuntime,
  evaluations: () => EvaluationApi,
): MountableRestApp {
  return runtime.mount(evaluationsLegacyRest.router(), evaluations);
}
