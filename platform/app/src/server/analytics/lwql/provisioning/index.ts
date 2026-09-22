/**
 * LangWatchQL provisioning — the public surface of the access-model deploy path.
 *
 * External consumers reach for this barrel and nothing deeper: the production
 * deploy task, the project service that writes the key map, and the API-route
 * integration suites that provision a container. The individual modules
 * (`accessModel.ts`, `catalogStatements.ts`, `postgresMapping.ts`,
 * `productionProvisioning.ts`, `selfProvisioning.ts`) are the subsystem's own
 * business; only what a caller outside `provisioning/` actually uses is
 * re-exported here.
 *
 * Deliberately not on the query path. The runtime executor derives its
 * connection from `../connection` and its ceilings from `../limits`, so it
 * never loads this barrel — importing it would pull the whole deploy-time graph
 * (the view catalog, the statement builders) onto every query boot, the exact
 * coupling this module keeps out.
 *
 * @see specs/lwql/api.feature
 */

export {
  lwqlViewSetupStatements,
  SHIPPED_LWQL_DEDUP,
} from "./catalogStatements";
export { redactSecrets } from "./clickhouseStatementRunner";
export {
  type LwqlKeyMapRow,
  lwqlKeyMapTableQualifiedName,
  productionLangWatchQLNames,
} from "./productionProvisioning";
export {
  type LwqlReconvergenceWatch,
  startLwqlReconvergenceWatch,
} from "./reconvergence";
export {
  lwqlAccessModelOwner,
  lwqlSelfProvisionInputs,
  selfProvisionAll,
} from "./selfProvisionEntry";
export {
  canProvisionAppFunctions,
  lwqlSelfProvisionFromEnv,
  probeAppFunctionStore,
} from "./selfProvisioning";
