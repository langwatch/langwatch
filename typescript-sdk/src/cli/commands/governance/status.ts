import chalk from "chalk";
import { loadConfig, isLoggedIn } from "@/cli/utils/governance/config";
import {
  getGovernanceStatus,
  GovernanceCliError,
} from "@/cli/utils/governance/cli-api";

/**
 * `langwatch governance status [--json]`
 *
 * Quick org health check showing the persona-routing setup-state
 * OR-of-flags. Mirrors `api.governance.setupState` exactly — same
 * boolean shape that drives the MainMenu Governance entry promotion
 * in the web UI.
 */
export async function governanceStatusCommand(options: {
  json?: boolean;
}): Promise<void> {
  const cfg = loadConfig();
  if (!isLoggedIn(cfg)) {
    process.stderr.write(
      "Not logged in — run `langwatch login --device` first\n",
    );
    process.exit(1);
  }

  let result;
  try {
    result = await getGovernanceStatus(cfg);
  } catch (err) {
    const msg = err instanceof GovernanceCliError ? err.message : String(err);
    process.stderr.write(`Error: ${msg}\n`);
    process.exit(1);
  }

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const { setup } = result;
  const check = (b: boolean) => (b ? chalk.green("✓") : chalk.gray("·"));
  console.log(chalk.bold("Governance setup state"));
  console.log(`  ${check(setup.hasPersonalVKs)} Personal VKs`);
  console.log(`  ${check(setup.hasRoutingPolicies)} Routing policies`);
  console.log(`  ${check(setup.hasIngestionSources)} Ingestion sources`);
  console.log(`  ${check(setup.hasAnomalyRules)} Anomaly rules`);
  console.log(`  ${check(setup.hasRecentActivity)} Recent activity (30d)`);
  console.log("");
  if (setup.governanceActive) {
    console.log(chalk.green("Governance active: yes"));
  } else {
    console.log(
      chalk.gray(
        "Governance active: no — connect any of the above to activate the /governance UI surface",
      ),
    );
  }
}
