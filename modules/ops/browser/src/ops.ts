/** Ops workspace loaders (per-page, not barrel—thirteen thousand lines, Foundry loads
 * xyflow/Monaco/OTel). ADR-004 one entry; six Backoffice resources share one screen. */

export { BACKOFFICE_RESOURCES, type BackofficeResource } from "./model/backoffice-resources.ts";
export { opsApi } from "./behavior/ops-api.ts";
export {
  OpsHostApi,
  OpsHostProvider,
  type OpsFailureNotice,
  type OpsProject,
  type OpsRouteReading,
  type OpsSuccessNotice,
} from "./model/ops-host.ts";
