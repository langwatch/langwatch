/** Test-only adapter access for Governance characterization suites. */
export { DATABRICKS_GENIE_ADAPTER_ID } from "./services/pull-destination.service";
export {
  DatabricksGeniePullerAdapter,
  type DatabricksGeniePullConfig,
} from "./adapters/databricks-genie-puller.adapter";
/**
 * The personal-key half of the Governance installation, on its own.
 */
export { PostgresPersonalVirtualKeyAdapter } from "./adapters/postgres.governance-personal-key.adapter";
export { PostgresRoutingPolicyAdapter } from "./adapters/postgres.governance-routing.adapter";
