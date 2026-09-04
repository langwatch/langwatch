/** Test-only adapter access for Governance characterization suites. */
export {
  DATABRICKS_GENIE_ADAPTER_ID,
  DatabricksGeniePuller,
  type DatabricksGeniePullConfig,
} from "./adapters/databricks-genie-puller.adapter";
/**
 * The personal-key half of the Governance installation, on its own.
 *
 * `PostgresGovernanceInstallationAdapter` builds every Governance capability
 * from one option bag, so a suite that only exercises personal virtual keys
 * would otherwise have to supply the ingestion, OTTL and anomaly collaborators
 * it never reaches. These two are what that suite composes instead.
 */
export { PostgresPersonalVirtualKeyAdapter } from "./adapters/postgres.governance-personal-key.adapter";
export { PostgresRoutingPolicyAdapter } from "./adapters/postgres.governance-routing.adapter";
