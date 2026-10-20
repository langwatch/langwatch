/**
 * Starts and polls run plans over the public API.
 * Usage: node src/runs-cli.ts run-plan NAME... | poll BATCH | retry NUM...
 * Reads LANGWATCH_ENDPOINT, LANGWATCH_API_KEY, LANGWATCH_PROJECT_ID; retry also LANGY_AGENT_ID.
 */
import { createLangWatchHttp, expectOk, readConfig, type LangWatchHttp } from "./http.ts";
import {
  formatRun,
  isBatchDone,
  matchScenarioIds,
  resolvePlanIds,
  retryPlanBody,
  summaryLine,
  unwrapList,
  type RunRow,
} from "./run-report.ts";

const POLL_EVERY_MS = 30_000;
const POLL_LIMIT = 240;

const http: LangWatchHttp = createLangWatchHttp({ config: readConfig({ env: process.env }) });

async function get<T>({ path }: { path: string }): Promise<T[]> {
  return unwrapList<T>({
    body: expectOk({ answer: await http.request({ method: "GET", path }), what: `GET ${path}` }),
  });
}

async function start({ path, body }: { path: string; body: unknown }): Promise<string> {
  const answer = await http.request<{ batchRunId?: string }>({ method: "POST", path, body });
  const batch = expectOk({ answer, what: `POST ${path}` }).batchRunId;
  if (!batch) throw new Error(`POST ${path}: no batchRunId in ${answer.text.slice(0, 300)}`);
  return batch;
}

/** Polls until every run is final and prints the report; false if any run did not pass. */
async function poll({ batch }: { batch: string }): Promise<boolean> {
  const path = `/api/v1/simulation-runs?batchRunId=${encodeURIComponent(batch)}&limit=100`;
  for (let i = 0; i < POLL_LIMIT; i++) {
    const runs = await get<RunRow>({ path });
    if (isBatchDone({ runs })) {
      runs.forEach((run) => console.log(formatRun({ run })));
      const summary = summaryLine({ runs });
      console.log(summary);
      return /^overall: (\d+)\/\1 /.test(summary);
    }
    console.error(`waiting: ${runs.length} runs in ${batch}`);
    await new Promise((resolve) => setTimeout(resolve, POLL_EVERY_MS));
  }
  throw new Error(
    `batch ${batch} not final after ${(POLL_LIMIT * POLL_EVERY_MS) / 60_000} minutes`,
  );
}

const [command, ...args] = process.argv.slice(2);
const argsOk = command === "poll" ? args.length === 1 : args.length > 0;
if (!command || !argsOk) {
  console.error("usage: run-plan NAME... | poll BATCH | retry NUM...");
  process.exit(2);
}

let allPassed = true;
if (command === "poll") {
  allPassed = await poll({ batch: args[0]! });
} else if (command === "run-plan") {
  const plans = resolvePlanIds({ plans: await get({ path: "/api/v1/run-plans" }), names: args });
  for (const { name, id } of plans) {
    const batch = await start({ path: `/api/v1/run-plans/${id}/run`, body: {} });
    console.log(`=== ${name} (${batch})`);
    allPassed = (await poll({ batch })) && allPassed;
  }
} else if (command === "retry") {
  const agentId = process.env.LANGY_AGENT_ID?.trim();
  if (!agentId) throw new Error("LANGY_AGENT_ID is required");
  const scenarioIds = matchScenarioIds({
    scenarios: await get({ path: "/api/v1/scenarios?limit=500" }),
    numbers: args,
  });
  console.log(`scenarios: ${scenarioIds.length}`);
  const batch = await start({
    path: "/api/v1/run-plans/run",
    body: retryPlanBody({ scenarioIds, agentId }),
  });
  console.log(`=== retry ${args.join(" ")} (${batch})`);
  allPassed = await poll({ batch });
} else {
  console.error(`unknown command "${command}"`);
  process.exit(2);
}
process.exit(allPassed ? 0 : 1);
