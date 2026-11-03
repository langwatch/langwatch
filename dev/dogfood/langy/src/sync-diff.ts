/**
 * What `npm run sync` would change: the scenario files and the run plan file against what the
 * project holds. Pure, so the decisions are tested without a stack.
 */

export interface ScenarioParameter {
  name: string;
  description?: string;
  defaultValue?: string | number | boolean;
  secret?: boolean;
  type?: string;
}

/** One scenario as a file states it. The name is its identity in the project. */
export interface ScenarioSpec {
  name: string;
  situation: string;
  criteria: string[];
  labels: string[];
  parameters: ScenarioParameter[];
  maxTurns: number | null;
  minTurns: number | null;
  simulatorModel: string | null;
  judgeModel: string | null;
}

export interface RemoteScenario extends ScenarioSpec {
  id: string;
}

/** The fields a sync owns; the rest of a scenario (its test suite, its fields) is left alone. */
export const SCENARIO_FIELDS = [
  "situation",
  "criteria",
  "labels",
  "parameters",
  "maxTurns",
  "minTurns",
  "simulatorModel",
  "judgeModel",
] as const satisfies readonly (keyof ScenarioSpec)[];

export type ScenarioField = (typeof SCENARIO_FIELDS)[number];

export type ScenarioChange =
  | { kind: "create"; spec: ScenarioSpec }
  | { kind: "update"; id: string; spec: ScenarioSpec; fields: ScenarioField[] }
  | { kind: "unchanged"; id: string; spec: ScenarioSpec };

/** The run plan as `run-plan.json` states it; `agent` is the connected agent's name. */
export interface RunPlanSpec {
  name: string;
  description: string | null;
  agent: string;
  repeatCount: number;
}

export interface RunPlanTarget {
  type: string;
  referenceId: string;
}

export interface RemoteRunPlan {
  id: string;
  name: string;
  description: string | null;
  scopeMode: string | null;
  scenarioIds: string[];
  targets: RunPlanTarget[];
  repeatCount: number;
}

/** The plan to reach: the spec with its agent and scenarios resolved to ids. */
export interface DesiredRunPlan {
  name: string;
  description: string | null;
  scenarioIds: string[];
  targets: RunPlanTarget[];
  repeatCount: number;
}

export type RunPlanField = "description" | "scope" | "scenarios" | "targets" | "repeatCount";

export type RunPlanChange =
  | { kind: "create"; desired: DesiredRunPlan }
  | {
      kind: "update";
      id: string;
      desired: DesiredRunPlan;
      fields: RunPlanField[];
      added: string[];
      removed: string[];
    }
  | { kind: "unchanged"; id: string };

/** Key order and absent-versus-undefined never count as a difference. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(
          Object.entries(inner)
            .filter(([, v]) => v !== undefined)
            .toSorted(([a], [b]) => a.localeCompare(b)),
        )
      : inner,
  );
}

function sameValue({ a, b }: { a: unknown; b: unknown }): boolean {
  return canonical(a) === canonical(b);
}

/** The names that occur more than once, so a sync never guesses which one is meant. */
function duplicates({ names }: { names: string[] }): string[] {
  return [...new Set(names.filter((name, index) => names.indexOf(name) !== index))];
}

/**
 * Pairs each file with the project's scenario of the same name: missing ones are created,
 * differing ones updated on the differing fields only. A name held twice is refused.
 */
export function diffScenarios({
  specs,
  remote,
}: {
  specs: ScenarioSpec[];
  remote: RemoteScenario[];
}): ScenarioChange[] {
  const fileDuplicates = duplicates({ names: specs.map((spec) => spec.name) });
  if (fileDuplicates.length > 0) {
    throw new Error(`Two scenario files share a name: ${fileDuplicates.join(", ")}`);
  }
  return specs.map((spec) => {
    const matches = remote.filter((scenario) => scenario.name === spec.name);
    if (matches.length > 1) {
      throw new Error(
        `The project holds ${matches.length} scenarios named "${spec.name}" (${matches.map((m) => m.id).join(", ")}); rename or archive one`,
      );
    }
    const [current] = matches;
    if (!current) return { kind: "create", spec };
    const fields = SCENARIO_FIELDS.filter(
      (field) => !sameValue({ a: spec[field], b: current[field] }),
    );
    return fields.length === 0
      ? { kind: "unchanged", id: current.id, spec }
      : { kind: "update", id: current.id, spec, fields };
  });
}

/**
 * The plan named in the spec must exist, pick exactly these scenarios and target exactly the
 * agent. Scenario order is not compared: the plan runs them all either way.
 */
export function diffRunPlan({
  desired,
  remote,
}: {
  desired: DesiredRunPlan;
  remote: RemoteRunPlan[];
}): RunPlanChange {
  const matches = remote.filter((plan) => plan.name === desired.name);
  if (matches.length > 1) {
    throw new Error(`The project holds ${matches.length} run plans named "${desired.name}"`);
  }
  const [current] = matches;
  if (!current) return { kind: "create", desired };

  const added = desired.scenarioIds.filter((id) => !current.scenarioIds.includes(id));
  const removed = current.scenarioIds.filter((id) => !desired.scenarioIds.includes(id));
  const fields: RunPlanField[] = [];
  if (desired.description !== current.description) fields.push("description");
  if (current.scopeMode !== "cases") fields.push("scope");
  if (added.length > 0 || removed.length > 0) fields.push("scenarios");
  if (!sameValue({ a: desired.targets, b: current.targets })) fields.push("targets");
  if (desired.repeatCount !== current.repeatCount) fields.push("repeatCount");

  return fields.length === 0
    ? { kind: "unchanged", id: current.id }
    : { kind: "update", id: current.id, desired, fields, added, removed };
}
