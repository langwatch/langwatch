import crypto from "crypto";
import { SCIM_SPEC_OPTIONS } from "@ee/scim/openapi";
import { app as scimApp } from "@ee/scim/routes";
import { generateSpecs as generateSpecsUnpinned } from "hono-openapi";
import { app as agentCacheApp } from "../app/api/agent-cache/[[...route]]/app";
import { app as agentsApp } from "../app/api/agents/[[...route]]/app";
import { app as analyticsApp } from "../app/api/analytics/[...route]/app";
import { app as analyticsSqlApp } from "../app/api/analytics-sql/[[...route]]/app";
import { app as apiKeysApp } from "../app/api/api-keys/[[...route]]/app";
import { app as codingAgentApp } from "../app/api/coding-agent/[[...route]]/app";
import { app as codingAgentV1App } from "../app/api/coding-agent/[[...route]]/app.v1";
import { app as dashboardsApp } from "../app/api/dashboards/[[...route]]/app";
import { app as datasetApp } from "../app/api/dataset/[[...route]]/app";
import { app as evaluatorsApp } from "../app/api/evaluators/[[...route]]/app";
import { app as eventsApp } from "../app/api/events/[[...route]]/app";
import { app as experimentsApp } from "../app/api/experiments/[[...route]]/app";
import { app as gatewayPlatformApp } from "../app/api/gateway-platform/[[...route]]/app";
import { app as gatewaySpendApp } from "../app/api/gateway-spend/[[...route]]/app";
import { app as governanceApp } from "../app/api/governance/[[...route]]/app";
import { app as graphsApp } from "../app/api/graphs/[[...route]]/app";
import { app as groupsApp } from "../app/api/groups/[[...route]]/app";
import { app as langyControlApp } from "../app/api/langy-control/[[...route]]/app";
import { app as meApp } from "../app/api/me/[[...route]]/app";
import { app as modelDefaultsApp } from "../app/api/model-defaults/[[...route]]/app";
import { app as modelProvidersApp } from "../app/api/model-providers/[[...route]]/app";
import { app as monitorsApp } from "../app/api/monitors/[[...route]]/app";
import currentSpec from "../app/api/openapiLangWatch.json";
import { app as organizationApp } from "../app/api/organization/[[...route]]/app";
import { app as organizationsApp } from "../app/api/organizations/[[...route]]/app";
import { ORGANIZATIONS_SPEC_OPTIONS } from "../app/api/organizations/[[...route]]/openapi";
import { app as projectsApp } from "../app/api/projects/[[...route]]/app";
import { app as llmConfigsApp } from "../app/api/prompts/[[...route]]/app";
import { app as queryApp } from "../app/api/query/[[...route]]/app";
import { app as roleBindingsApp } from "../app/api/role-bindings/[[...route]]/app";
import { app as rolesApp } from "../app/api/roles/[[...route]]/app";
import { app as runPlansApp } from "../app/api/run-plans/[[...route]]/app";
import { app as scenarioEventsApp } from "../app/api/scenario-events/[[...route]]/app";
import { app as scenariosApp } from "../app/api/scenarios/[[...route]]/app";
import { app as scimTokensApp } from "../app/api/scim-tokens/[[...route]]/app";
import { app as secretsApp } from "../app/api/secrets/[[...route]]/app";
import { app as simulationRunsApp } from "../app/api/simulation-runs/[[...route]]/app";
import { app as suitesApp } from "../app/api/suites/[[...route]]/app";
import { app as teamsApp } from "../app/api/teams/[[...route]]/app";
import { app as testSuitesApp } from "../app/api/test-suites/[[...route]]/app";
import { app as tracesApp } from "../app/api/traces/[[...route]]/app";
import { app as triggersApp } from "../app/api/triggers/[[...route]]/app";
import { app as webhooksApp } from "../app/api/webhooks/[[...route]]/app";
import { app as workflowsApp } from "../app/api/workflows/[[...route]]/app";
import { app as evaluationsLegacyApp } from "../server/routes/evaluations-legacy";
import { app as experimentsV3App } from "../server/routes/experiments-v3";
import { app as miscApp } from "../server/routes/misc";
import { requireDefaultedResponseFields } from "../server/api/openapi-response-required";
import { mergeOpenAPISpecs, type OpenAPISpec } from "./mergeOpenAPISpecs";

const generateSpecs: typeof generateSpecsUnpinned = async (hono, options, c) =>
  requireDefaultedResponseFields(await generateSpecsUnpinned(hono, options, c));

const langwatchSpec = {
  openapi: "3.1.0",
  info: { title: "LangWatch API", version: "1.0.0", description: "LangWatch openapi spec" },
};

const appDefs: Array<[string, () => Promise<unknown>]> = [
  ["agent-cache", () => generateSpecs(agentCacheApp)],
  ["agents", () => generateSpecs(agentsApp)],
  ["api-keys", () => generateSpecs(apiKeysApp)],
  ["analytics", () => generateSpecs(analyticsApp)],
  ["analytics-sql", () => generateSpecs(analyticsSqlApp)],
  ["query", () => generateSpecs(queryApp)],
  ["coding-agent", () => generateSpecs(codingAgentApp)],
  ["coding-agent-v1", () => generateSpecs(codingAgentV1App)],
  ["dashboards", () => generateSpecs(dashboardsApp)],
  ["dataset", () => generateSpecs(datasetApp)],
  ["evaluators", () => generateSpecs(evaluatorsApp)],
  ["events", () => generateSpecs(eventsApp)],
  ["experiments", () => generateSpecs(experimentsApp)],
  ["evaluations-legacy", () => generateSpecs(evaluationsLegacyApp)],
  ["experiments-v3", () => generateSpecs(experimentsV3App)],
  ["misc", () => generateSpecs(miscApp)],
  ["gateway-platform", () => generateSpecs(gatewayPlatformApp)],
  ["governance", () => generateSpecs(governanceApp)],
  ["graphs", () => generateSpecs(graphsApp)],
  ["langy-control", () => generateSpecs(langyControlApp)],
  ["me", () => generateSpecs(meApp)],
  ["prompts", () => generateSpecs(llmConfigsApp)],
  ["model-defaults", () => generateSpecs(modelDefaultsApp)],
  ["model-providers", () => generateSpecs(modelProvidersApp)],
  ["monitors", () => generateSpecs(monitorsApp)],
  ["organization", () => generateSpecs(organizationApp)],
  ["organizations", () => generateSpecs(organizationsApp, ORGANIZATIONS_SPEC_OPTIONS)],
  ["projects", () => generateSpecs(projectsApp)],
  ["roles", () => generateSpecs(rolesApp)],
  ["role-bindings", () => generateSpecs(roleBindingsApp)],
  ["scim-tokens", () => generateSpecs(scimTokensApp)],
  ["scim", () => generateSpecs(scimApp, SCIM_SPEC_OPTIONS)],
  ["secrets", () => generateSpecs(secretsApp)],
  ["scenarios", () => generateSpecs(scenariosApp)],
  ["simulation-runs", () => generateSpecs(simulationRunsApp)],
  ["suites", () => generateSpecs(suitesApp)],
  ["run-plans", () => generateSpecs(runPlansApp)],
  ["test-suites", () => generateSpecs(testSuitesApp)],
  ["teams", () => generateSpecs(teamsApp)],
  ["groups", () => generateSpecs(groupsApp)],
  ["traces", () => generateSpecs(tracesApp)],
  ["triggers", () => generateSpecs(triggersApp)],
  ["webhooks", () => generateSpecs(webhooksApp)],
  ["workflows", () => generateSpecs(workflowsApp)],
  ["gateway-spend", () => generateSpecs(gatewaySpendApp)],
  ["scenario-events", () => generateSpecs(scenarioEventsApp)],
];

function sha256(obj: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(obj)).digest("hex");
}

function pathKeys(spec: OpenAPISpec): Set<string> {
  return new Set(Object.keys((spec as { paths?: Record<string, unknown> }).paths ?? {}));
}

async function main() {
  console.log("=== APP GENERATION ===");
  const succeeded: string[] = [];
  const failed: Array<{ name: string; error: string }> = [];
  const appSpecs: unknown[] = [];

  for (const [name, gen] of appDefs) {
    try {
      const spec = await gen();
      appSpecs.push(spec);
      succeeded.push(name);
    } catch (err) {
      failed.push({ name, error: err instanceof Error ? err.message : String(err) });
    }
  }

  console.log(`succeeded ${succeeded.length}/${appDefs.length}:`, succeeded.join(", "));
  for (const f of failed) {
    console.log(`FAILED  ${f.name}: ${f.error.slice(0, 200)}`);
  }

  console.log("\n=== IDEMPOTENCY (fixed point) ===");
  const regen1 = mergeOpenAPISpecs({
    currentSpec: currentSpec as OpenAPISpec,
    appSpecs: appSpecs as OpenAPISpec[],
    baseSpec: langwatchSpec,
  });
  const regen2 = mergeOpenAPISpecs({
    currentSpec: regen1,
    appSpecs: appSpecs as OpenAPISpec[],
    baseSpec: langwatchSpec,
  });
  const sha1 = sha256(regen1);
  const sha2 = sha256(regen2);
  console.log(`sha256(regen1): ${sha1}`);
  console.log(`sha256(regen2): ${sha2}`);
  console.log(`idempotent (regen1==regen2): ${sha1 === sha2}`);

  console.log("\n=== ORPHAN PRUNING ===");
  const orphanPath = "/api/agents/__orphan_probe_pr5005__";
  const currentWithOrphan: OpenAPISpec = {
    ...(currentSpec as OpenAPISpec),
    paths: {
      ...((currentSpec as { paths?: Record<string, unknown> }).paths ?? {}),
      [orphanPath]: { get: { responses: { "200": { description: "probe" } } } },
    },
  };
  const regenWithOrphanInput = mergeOpenAPISpecs({
    currentSpec: currentWithOrphan,
    appSpecs: appSpecs as OpenAPISpec[],
    baseSpec: langwatchSpec,
  });
  const presentInInput = orphanPath in (currentWithOrphan.paths ?? {});
  const presentInOutput = orphanPath in ((regenWithOrphanInput as { paths?: Record<string, unknown> }).paths ?? {});
  console.log(`orphan injected: ${orphanPath}`);
  console.log(`present in INPUT : ${presentInInput}`);
  console.log(`present in OUTPUT: ${presentInOutput} (false = pruned)`);
  console.log(`regen(committed+orphan)==regen(committed): ${sha256(regenWithOrphanInput) === sha1}`);

  console.log("\n=== HAND-MAINTAINED NAMESPACES PRESERVED ===");
  const ownedNamespaces = new Set<string>();
  for (const spec of appSpecs as OpenAPISpec[]) {
    for (const p of Object.keys((spec as { paths?: Record<string, unknown> }).paths ?? {})) {
      const segs = p.split("/").filter(Boolean);
      ownedNamespaces.add(segs.length === 0 ? "/" : "/" + segs.slice(0, 2).join("/"));
    }
  }
  const committedNamespaces = new Set<string>();
  for (const p of Object.keys((currentSpec as { paths?: Record<string, unknown> }).paths ?? {})) {
    const segs = p.split("/").filter(Boolean);
    committedNamespaces.add(segs.length === 0 ? "/" : "/" + segs.slice(0, 2).join("/"));
  }
  const handMaintained = [...committedNamespaces].filter((n) => !ownedNamespaces.has(n)).sort();
  for (const ns of handMaintained) {
    const stillPresent = [...pathKeys(regen1 as OpenAPISpec)].some((p) => {
      const segs = p.split("/").filter(Boolean);
      const nsOf = segs.length === 0 ? "/" : "/" + segs.slice(0, 2).join("/");
      return nsOf === ns;
    });
    console.log(`  ${stillPresent ? "PRESENT " : "MISSING "} ${ns}`);
  }

  console.log("\n=== PATH DELTA (committed -> regen1) ===");
  const before = pathKeys(currentSpec as OpenAPISpec);
  const after = pathKeys(regen1 as OpenAPISpec);
  const dropped = [...before].filter((p) => !after.has(p));
  const added = [...after].filter((p) => !before.has(p));
  console.log(`paths: ${before.size} -> ${after.size}`);
  console.log(`dropped: ${dropped.length}   ${JSON.stringify(dropped)}`);
  console.log(`added:   ${added.length}   ${JSON.stringify(added)}`);

  // Which of the dropped paths are under a namespace that FAILED to generate
  // this run (fail-safe should have preserved those, not dropped them).
  const failedNamespaces = new Set(failed.map((f) => f.name));
  console.log(`\nfailed app names (for cross-check against dropped, if any): ${[...failedNamespaces].join(", ") || "(none)"}`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("PROBE SCRIPT ERROR:", err);
  process.exit(1);
});
