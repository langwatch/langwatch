/** Test-only adapter access for Governance characterization suites. */
export { DATABRICKS_GENIE_ADAPTER_ID } from "./services/pull-destination.service.ts";
export {
  DatabricksGeniePullerAdapter,
  type DatabricksGeniePullConfig,
} from "./adapters/databricks-genie-puller.adapter.ts";
/**
 * The personal-key half of the Governance installation, on its own.
 */
export { PostgresPersonalVirtualKeyAdapter } from "./adapters/postgres.governance-personal-key.adapter.ts";
export { PostgresRoutingPolicyAdapter } from "./adapters/postgres.governance-routing.adapter.ts";
export { PostgresDepartmentAdapter } from "./adapters/postgres.department.adapter.ts";
