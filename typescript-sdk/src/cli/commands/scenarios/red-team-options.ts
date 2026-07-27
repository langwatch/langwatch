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

/** The body fields the scenarios API takes. */
export interface RedTeamBody {
  redTeamStrategy?: string | null;
  redTeamTarget?: string | null;
  redTeamTotalTurns?: number | null;
  redTeamConfig?: {
    scoreResponses?: boolean;
    detectRefusals?: boolean;
  } | null;
}

export class RedTeamOptionError extends Error {}

/**
 * Turns the flags into request body fields, or throws with something the user
 * can act on. Returns only the keys actually supplied, so an update never
 * clears a field it was not asked about.
 */
export function toRedTeamBody(options: RedTeamCliOptions): RedTeamBody {
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
    if (strategy !== "crescendo" && strategy !== "goat") {
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
    if (!Number.isInteger(turns) || turns < 1 || turns > 50) {
      throw new RedTeamOptionError(
        `--red-team-turns must be a whole number between 1 and 50, got "${options.redTeamTurns}".`,
      );
    }
    body.redTeamTotalTurns = turns;
  }

  // Commander gives `false` for --no-red-team-scoring and leaves it undefined
  // otherwise. Scoring and refusal detection move together, matching the SDK's
  // documented recipe for a cheaper run.
  if (options.redTeamScoring === false) {
    body.redTeamConfig = { scoreResponses: false, detectRefusals: false };
  }

  // A strategy without an objective has nothing to pursue, and the platform
  // treats it as a standard scenario — better to say so than to create one.
  if (body.redTeamStrategy && body.redTeamTarget === undefined) {
    throw new RedTeamOptionError(
      "--red-team-strategy needs --red-team-target: the attack has to know what it is trying to achieve.",
    );
  }

  return body;
}
