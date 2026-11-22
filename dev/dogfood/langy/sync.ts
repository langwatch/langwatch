/**
 * Makes a project's Langy scenarios and run plan match `scenarios/*.json` and `run-plan.json`,
 * over the public API only. `--dry-run` prints the changes and writes nothing.
 * Usage: npm run sync [-- --dry-run]
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createLangWatchHttp, readConfig } from "./src/http.ts";
import {
  createRunPlan,
  createScenario,
  findConnectedAgentId,
  listRunPlans,
  listScenarios,
  updateRunPlan,
  updateScenario,
} from "./src/sync-api.ts";
import { diffRunPlan, diffScenarios, type DesiredRunPlan } from "./src/sync-diff.ts";
import { readRunPlanSpec, readScenarioSpecs } from "./src/sync-files.ts";

const here = dirname(fileURLToPath(import.meta.url));
const dryRun = process.argv.includes("--dry-run");
const http = createLangWatchHttp({ config: readConfig({ env: process.env }) });

const specs = readScenarioSpecs({ dir: join(here, "scenarios") });
const planSpec = readRunPlanSpec({
  file: process.env.LANGY_RUN_PLAN_FILE ?? join(here, "run-plan.json"),
});

const [remoteScenarios, remotePlans, agentId] = await Promise.all([
  listScenarios({ http }),
  listRunPlans({ http }),
  findConnectedAgentId({ http, name: planSpec.agent }),
]);

console.log(`${dryRun ? "Dry run: " : ""}${http.projectId}, ${specs.length} scenario files`);

const idByName = new Map(remoteScenarios.map((scenario) => [scenario.name, scenario.id]));
let unchanged = 0;
for (const change of diffScenarios({ specs, remote: remoteScenarios })) {
  if (change.kind === "unchanged") {
    unchanged++;
    continue;
  }
  if (change.kind === "create") {
    console.log(`  + scenario "${change.spec.name}"`);
    if (!dryRun) idByName.set(change.spec.name, await createScenario({ http, spec: change.spec }));
    continue;
  }
  console.log(`  ~ scenario "${change.spec.name}": ${change.fields.join(", ")}`);
  if (!dryRun) await updateScenario({ http, id: change.id, spec: change.spec });
}
console.log(`  = ${unchanged} scenarios unchanged`);

// In a dry run a scenario still to be created has no id; its name stands in for one.
const desired: DesiredRunPlan = {
  name: planSpec.name,
  description: planSpec.description,
  scenarioIds: specs.map((spec) => idByName.get(spec.name) ?? `(new) ${spec.name}`),
  targets: [{ type: "connected", referenceId: agentId }],
  repeatCount: planSpec.repeatCount,
};
const nameById = new Map([...idByName].map(([name, id]) => [id, name]));
const label = (id: string): string => nameById.get(id) ?? id;

const planChange = diffRunPlan({ desired, remote: remotePlans });
if (planChange.kind === "unchanged") {
  console.log(`  = run plan "${desired.name}" unchanged`);
} else if (planChange.kind === "create") {
  console.log(`  + run plan "${desired.name}" with ${desired.scenarioIds.length} scenarios`);
  if (!dryRun) await createRunPlan({ http, desired });
} else {
  console.log(`  ~ run plan "${desired.name}": ${planChange.fields.join(", ")}`);
  for (const id of planChange.added) console.log(`      + ${label(id)}`);
  for (const id of planChange.removed) console.log(`      - ${label(id)}`);
  if (!dryRun) await updateRunPlan({ http, id: planChange.id, desired });
}
