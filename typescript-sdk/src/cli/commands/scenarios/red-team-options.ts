/**
 * The red-team flags shared by `scenario create` and `scenario update`.
 *
 * Kept in one place because the platform learned this lesson the expensive
 * way: the same write contract written out twice, once per route, drifted
 * until one copy validated the fields and never sent them. A CLI that grows a
 * third hand-rolled copy would drift the same way.
 */

/** Raw option values as commander hands them over — everything is a string. */
export interface RedTeamCliOptions {
  redTeamStrategy?: string;
  redTeamTarget?: string;
  redTeamTurns?: string;
  redTeamScoring?: boolean;
  standard?: boolean;
}

/** The strategies the platform accepts, mirrored from the API contract. */
export type RedTeamStrategyName = "crescendo" | "goat";

/**
 * The stored tuning knobs. Open-ended on purpose: the CLI exposes two of them
 * and the platform has several more, and a merge that only knew about its own
 * two would drop the rest on the way through — which is the loss this file
 * exists to prevent, reintroduced one release later when a knob is added.
 */
export type RedTeamConfigBody = Record<string, unknown> & {
  scoreResponses?: boolean;
  detectRefusals?: boolean;
};

/** The body fields the scenarios API takes. */
export interface RedTeamBody {
  redTeamStrategy?: RedTeamStrategyName | null;
  redTeamTarget?: string | null;
  redTeamTotalTurns?: number | null;
  redTeamConfig?: RedTeamConfigBody | null;
}

/**
 * Which command is asking. `create` writes a whole scenario, so the flags are
 * the entire final state and can be checked on their own; `update` writes a
 * patch over a row that already exists, and the same check there would reject
 * requests the API accepts.
 */
export type RedTeamCommandMode = "create" | "update";

/**
 * Mirrors RED_TEAM_MAX_TURNS on the platform, which owns the real limit and
 * rejects anything past it. Duplicated because the CLI cannot import from the
 * app; the point of checking here is a message that names the flag rather than
 * a validation error from a round trip.
 */
const MAX_TURNS = 50;

export class RedTeamOptionError extends Error {}

function isStrategy(value: string): value is RedTeamStrategyName {
  return value === "crescendo" || value === "goat";
}

/**
 * Turns the flags into request body fields, or throws with something the user
 * can act on. Returns only the keys actually supplied, so an update never
 * clears a field it was not asked about.
 *
 * `redTeamConfig` is deliberately absent from the result except for the
 * `--standard` clear — see `redTeamConfigPatch`, which the caller merges over
 * the stored config, because the API replaces that column wholesale.
 */
export function toRedTeamBody(
  options: RedTeamCliOptions,
  { mode }: { mode: RedTeamCommandMode },
): RedTeamBody {
  // --standard is the way back: an attack is configured across several fields,
  // so clearing them one flag at a time would be a trap.
  if (options.standard) {
    if (options.redTeamStrategy ?? options.redTeamTarget ?? options.redTeamTurns) {
      throw new RedTeamOptionError(
        "--standard cannot be combined with the other red-team flags; it clears them.",
      );
    }
    return {
      redTeamStrategy: null,
      redTeamTarget: null,
      redTeamTotalTurns: null,
      redTeamConfig: null,
    };
  }

  const body: RedTeamBody = {};

  if (options.redTeamStrategy !== undefined) {
    const strategy = options.redTeamStrategy.toLowerCase();
    if (!isStrategy(strategy)) {
      throw new RedTeamOptionError(
        `Unknown red-team strategy "${options.redTeamStrategy}". Use crescendo or goat.`,
      );
    }
    body.redTeamStrategy = strategy;
  }

  if (options.redTeamTarget !== undefined) {
    const target = options.redTeamTarget.trim();
    if (target.length === 0) {
      throw new RedTeamOptionError(
        "--red-team-target cannot be empty; it is what the attack aims at.",
      );
    }
    body.redTeamTarget = target;
  }

  if (options.redTeamTurns !== undefined) {
    const turns = Number(options.redTeamTurns);
    if (!Number.isInteger(turns) || turns < 1 || turns > MAX_TURNS) {
      throw new RedTeamOptionError(
        `--red-team-turns must be a whole number between 1 and ${MAX_TURNS}, got "${options.redTeamTurns}".`,
      );
    }
    body.redTeamTotalTurns = turns;
  }

  // A strategy without an objective has nothing to pursue, and the platform
  // treats it as a standard scenario — better to say so than to create one.
  //
  // Only on create. This is a rule about a scenario's final state, not about a
  // request: `scenario update --red-team-strategy goat` on a scenario that
  // already has an objective is a perfectly good operation, and the API
  // accepts it by merging before it checks. Asking it of a patch made the CLI
  // exit 1 on work the platform was happy to do.
  if (
    mode === "create" &&
    body.redTeamStrategy &&
    body.redTeamTarget === undefined
  ) {
    throw new RedTeamOptionError(
      "--red-team-strategy needs --red-team-target: the attack has to know what it is trying to achieve.",
    );
  }

  return body;
}

/**
 * The config keys the flags ask to change, or undefined when they ask for
 * nothing.
 *
 * Kept out of `toRedTeamBody` because `redTeamConfig` is a single JSONB column
 * and a write replaces all of it. Sending `{ scoreResponses: false }` on its
 * own therefore does not turn one knob off — it deletes the attack plan, the
 * stop-early score and the obfuscation rate somebody set in the editor, and
 * answers 200. The caller merges this over what is stored.
 *
 * Commander does not leave a `--no-x` boolean undefined: it defaults the
 * option to `true` and sets `false` only when the flag is passed. So `false`
 * is the signal, and the absence of the flag is indistinguishable from
 * `--red-team-scoring` — which is why there is no way to turn scoring back on
 * from here.
 */
export function redTeamConfigPatch(
  options: RedTeamCliOptions,
): RedTeamConfigBody | undefined {
  if (options.redTeamScoring !== false) return undefined;
  // Scoring and refusal detection move together, matching the SDK's
  // documented recipe for a cheaper run.
  return { scoreResponses: false, detectRefusals: false };
}

/**
 * Fold the flags' config changes into what the scenario already has.
 *
 * `stored` comes back from the API, so a knob the CLI has never heard of
 * survives the round trip.
 */
export function mergeRedTeamConfig(
  patch: RedTeamConfigBody,
  stored: RedTeamConfigBody | null | undefined,
): RedTeamConfigBody {
  return { ...(stored ?? {}), ...patch };
}
