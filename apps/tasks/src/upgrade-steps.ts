import { writeFileSync } from "node:fs";

import { migrationStepsOverMemory } from "@langwatch/process";
import { isMigrationStep } from "@langwatch/upgrade/step";

import { processModules } from "./process-modules.generated.ts";
import { codeStepOf, UpgradeArgumentError } from "./upgrade.ts";

/** Invented and harmless: the list is an image fact, so it never reads the host's environment. */
const LISTING_ENVIRONMENT = {
  NODE_ENV: "production",
  BASE_HOST: "http://langwatch.invalid",
  // The API-key pepper chain refuses a boot where none of its secrets is set.
  API_KEY_PEPPER: "migration-step-listing",
} as const;

/**
 * `pnpm task upgrade steps [--json] [--out <file>]`: the installed modules' code steps, booted
 * over memory stores. `--out` keeps the list apart from boot logs on stdout. Spec:
 * specs/upgrade/serving-gate.feature.
 */
export async function upgradeSteps({
  args,
  write = (text) => process.stdout.write(text),
}: {
  args: readonly string[];
  write?: (text: string) => void;
}): Promise<void> {
  const json = args.includes("--json");
  const outAt = args.indexOf("--out");
  const out = outAt === -1 ? undefined : args[outAt + 1];
  const unknown = args.find(
    (argument, index) => argument !== "--json" && index !== outAt && index !== outAt + 1,
  );
  if (unknown !== undefined) throw new UpgradeArgumentError(unknown);
  if (outAt !== -1 && out === undefined) throw new UpgradeArgumentError("--out without a file");
  const steps = await migrationStepsOverMemory({
    name: "langwatch-tasks",
    modules: processModules,
    environment: LISTING_ENVIRONMENT,
    isMigrationStep,
  });
  const listed = steps.map(codeStepOf);
  const text = json
    ? `${JSON.stringify(listed, null, 2)}\n`
    : listed.map((step) => `${step.mode}\t${step.kind}\t${step.id}\n`).join("");
  if (out === undefined) write(text);
  else writeFileSync(out, text);
}
