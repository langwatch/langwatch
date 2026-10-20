/** Every world the `world` run parameter can name, and how the parameter is read. */

/** The default world: a prompt with a marker phrase and errored traces (prompt-world.ts). */
export const PROMPT_WORLD = "prompt_and_traces";
/** Topic Clustering setup (topic-world.ts). */
export const TOPIC_WORLD = "T1";
/** Old traffic only, asked about the last 2 hours (quiet-world.ts). */
export const QUIET_WORLD = "W1";
/** A coding-agent cost question that leads to `langwatch whoami` (login-world.ts). */
export const LOGIN_WORLD = "C1";
/** Create-then-check runs: a per-run tag in every name (resources-world.ts). */
export const RESOURCES_WORLD = "resources";
/** The board worlds (worlds.ts). */
export const MATRIX_WORLD_NAMES = ["D1", "D2", "A1", "D3", "X1", "D5", "B1"] as const;

export type MatrixWorld = (typeof MATRIX_WORLD_NAMES)[number];
export type WorldName =
  | MatrixWorld
  | typeof PROMPT_WORLD
  | typeof TOPIC_WORLD
  | typeof QUIET_WORLD
  | typeof LOGIN_WORLD
  | typeof RESOURCES_WORLD;
export const WORLD_NAMES: readonly WorldName[] = [
  PROMPT_WORLD,
  ...MATRIX_WORLD_NAMES,
  TOPIC_WORLD,
  QUIET_WORLD,
  LOGIN_WORLD,
  RESOURCES_WORLD,
];

export function isMatrixWorld(value: unknown): value is MatrixWorld {
  return (MATRIX_WORLD_NAMES as readonly unknown[]).includes(value);
}

/** The `world` run parameter: empty means the default world; an unknown name is refused. */
export function parseWorld({ value }: { value: unknown }): WorldName {
  const name = typeof value === "string" ? value.trim() : "";
  if (name === "") return PROMPT_WORLD;
  const known = WORLD_NAMES.find((world) => world === name);
  if (known) return known;
  throw new Error(`unknown world "${name}": use one of ${WORLD_NAMES.join(", ")}`);
}
