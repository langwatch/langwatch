import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { mapSchema, publishFeatures } from "./map.ts";
import { runSimulation, type RunOptions } from "./run.ts";

const USAGE = `interactionsimulator run [-features a,b] [-journeys N] [-pages N] [-steps N]
                          [-budget-usd X] [-minutes N] [-url URL]
interactionsimulator publish -pr N [-map FILE]

Keys come from the environment: ANTHROPIC_API_KEY, JEV_BASE_URL, JEV_API_KEY (JEV_MODEL optional).
Outputs land in .interactionsimulator/<run>/: map.json, map.md, findings.jsonl, flows/, timing.md.`;

const ROOT = resolve(import.meta.dirname, "..", "..", "..");

/** keysFromEnvironment reads the model keys; they are never printed, and .env is never read. */
const keysFromEnvironment = (): RunOptions["keys"] => {
  const { ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL, JEV_BASE_URL, JEV_API_KEY, JEV_MODEL } =
    process.env;
  if (!ANTHROPIC_API_KEY || !JEV_BASE_URL || !JEV_API_KEY) {
    const missing = Object.entries({ ANTHROPIC_API_KEY, JEV_BASE_URL, JEV_API_KEY })
      .filter(([, value]) => !value)
      .map(([name]) => name);
    throw new Error(`set ${missing.join(", ")} in the environment; the simulator never reads .env`);
  }
  return {
    sonnet: {
      apiKey: ANTHROPIC_API_KEY,
      ...(ANTHROPIC_BASE_URL ? { baseUrl: ANTHROPIC_BASE_URL } : {}),
    },
    jev: { baseUrl: JEV_BASE_URL, apiKey: JEV_API_KEY, ...(JEV_MODEL ? { model: JEV_MODEL } : {}) },
  };
};

/** flagsOf reads Go-style single-dash flags, each followed by its value. */
export const flagsOf = (args: string[]): Map<string, string> => {
  const flags = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index] ?? "";
    const value = args[index + 1];
    if (!name.startsWith("-") || value === undefined)
      throw new Error(`expected -flag value, got "${name}"`);
    flags.set(name.replace(/^--?/, ""), value);
  }
  return flags;
};

const numberFlag = ({
  flags,
  name,
  fallback,
}: {
  flags: Map<string, string>;
  name: string;
  fallback: number;
}): number => {
  const value = Number(flags.get(name) ?? fallback);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`-${name} must be a positive number`);
  return value;
};

const run = async (flags: Map<string, string>): Promise<number> => {
  const outcome = await runSimulation({
    root: ROOT,
    keys: keysFromEnvironment(),
    url: flags.get("url") ?? "https://app.visualdiff-check.langwatch.localhost",
    features: (flags.get("features") ?? "").split(",").filter((name) => name !== ""),
    journeys: numberFlag({ flags, name: "journeys", fallback: 3 }),
    pages: numberFlag({ flags, name: "pages", fallback: 2 }),
    steps: numberFlag({ flags, name: "steps", fallback: 25 }),
    budgetUsd: numberFlag({ flags, name: "budget-usd", fallback: 5 }),
    minutes: numberFlag({ flags, name: "minutes", fallback: 30 }),
  });
  process.stdout.write(readFileSync(join(outcome.out, "map.md"), "utf8"));
  process.stdout.write(`\n${readFileSync(join(outcome.out, "timing.md"), "utf8")}`);
  process.stdout.write(
    `\nfindings=${outcome.findings} flows=${outcome.flows} out=${outcome.out}\n`,
  );
  return outcome.findings > 0 ? 1 : 0;
};

const publish = (flags: Map<string, string>): number => {
  const pr = flags.get("pr");
  if (pr === undefined || !/^\d+$/.test(pr)) throw new Error("publish needs -pr N");
  const mapFile = flags.get("map") ?? join(ROOT, ".interactionsimulator", "map.json");
  const map = mapSchema.parse(JSON.parse(readFileSync(mapFile, "utf8")));
  const path = `repos/{owner}/{repo}/pulls/${pr}`;
  const body = execFileSync("gh", ["api", path, "--jq", ".body"], {
    cwd: ROOT,
    encoding: "utf8",
  }).replace(/\n$/, "");
  const next = publishFeatures({ body, map });
  if (next === body) {
    process.stderr.write(
      "publish: the PR body has no features table between the parity-status markers\n",
    );
    return 1;
  }
  const file = join(ROOT, ".interactionsimulator", "pr-body.md");
  writeFileSync(file, next);
  execFileSync("gh", ["api", path, "-X", "PATCH", "-F", `body=@${file}`], {
    cwd: ROOT,
    stdio: ["ignore", "ignore", "inherit"],
  });
  process.stderr.write(`publish: updated the features table on #${pr}\n`);
  return 0;
};

const main = async (): Promise<number> => {
  const [command, ...rest] = process.argv.slice(2);
  try {
    if (command === "run") return await run(flagsOf(rest));
    if (command === "publish") return publish(flagsOf(rest));
    process.stderr.write(`${USAGE}\n`);
    return 2;
  } catch (thrown) {
    process.stderr.write(
      `interactionsimulator: ${thrown instanceof Error ? thrown.message : String(thrown)}\n`,
    );
    return 2;
  }
};

process.exitCode = await main();
