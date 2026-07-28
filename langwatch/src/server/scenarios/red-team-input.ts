/**
 * The red-team half of a scenario's write contract, shared by every route that
 * can create or update one.
 *
 * This lives in one place because it was previously written out twice — once
 * in the tRPC router and once in the REST route — and the copies drifted in
 * the way duplicated contracts always do: the REST copy validated the fields
 * and then never passed them to the service, so `POST /api/scenarios` accepted
 * a red-team scenario, answered 201, and persisted a standard one. Nothing
 * failed; the attack configuration was simply gone.
 *
 * @see specs/scenarios/red-team-scenarios.feature
 */
import { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  RED_TEAM_MAX_TURNS,
  RedTeamConfigSchema,
  RedTeamStrategySchema,
  type RedTeamConfig,
} from "./execution/types";

/**
 * Spread into a create/update schema. Every field is nullish: absent leaves it
 * alone, explicit null clears it, which is how the editor turns a red-team
 * scenario back into a standard one.
 */
export const redTeamFields = {
  redTeamStrategy: RedTeamStrategySchema.nullish(),
  /**
   * Trimmed before the length check: a target of spaces would pass `min(1)`
   * and give the attack planner nothing to aim at.
   */
  redTeamTarget: z.string().trim().min(1).nullish(),
  redTeamTotalTurns: z
    .number()
    .int()
    .min(1)
    .max(RED_TEAM_MAX_TURNS)
    .nullish(),
  redTeamConfig: RedTeamConfigSchema.nullish(),
};

/**
 * Prisma distinguishes "SQL NULL" from "JSON null" on a Json column, so an
 * explicit null has to be spelled `Prisma.DbNull` rather than passed straight
 * through. Omitting the key entirely (undefined) leaves the column untouched.
 */
export function toPrismaRedTeamConfig(
  value: RedTeamConfig | null | undefined,
): { redTeamConfig?: Prisma.InputJsonValue | typeof Prisma.DbNull } {
  if (value === undefined) return {};
  if (value === null) return { redTeamConfig: Prisma.DbNull };
  return { redTeamConfig: value };
}

/**
 * The rules that only make sense against a scenario's *final* state, so they
 * cannot live in the field schemas above.
 *
 * A PUT that sets only `redTeamStrategy` on a scenario that already has an
 * objective is legitimate, so a per-field `required` would reject valid
 * updates. Callers merge first, then ask this.
 */
export function redTeamStateIssue(state: RedTeamInput): {
  field: keyof RedTeamInput;
  message: string;
} | null {
  const strategy = state.redTeamStrategy ?? null;
  const target = state.redTeamTarget?.trim() ?? "";

  // Without an objective the run silently falls back to the cooperative user
  // simulator: the scenario looks configured, the attack never happens, and
  // the judge reports that the agent held up.
  if (strategy && !target) {
    return {
      field: "redTeamTarget",
      message:
        "A red-team scenario needs an attack objective — without one the run falls back to a standard scenario.",
    };
  }

  // GOAT reasons turn by turn and never generates a plan, so the SDK ignores
  // both planner fields for it. Accepting them would be accepting settings
  // that do nothing.
  if (strategy === "goat") {
    const config = state.redTeamConfig ?? undefined;
    // Truthiness, not `??`: an empty attackPlan is not nullish, so `??` would
    // short-circuit on "" and hide a metapromptTemplate that IS set.
    if (Boolean(config?.attackPlan) || Boolean(config?.metapromptTemplate)) {
      return {
        field: "redTeamConfig",
        message:
          "An attack plan and planning prompt only apply to Crescendo — GOAT plans nothing, so the SDK ignores them.",
      };
    }
  }

  return null;
}

/** The shape `redTeamFields` parses to, before Prisma translation. */
export interface RedTeamInput {
  redTeamStrategy?: string | null;
  redTeamTarget?: string | null;
  redTeamTotalTurns?: number | null;
  redTeamConfig?: RedTeamConfig | null;
}


/**
 * Merge a partial write over what is stored.
 *
 * `??` is wrong here: it treats an explicit `null` as "not supplied", so a
 * request clearing the objective merges the OLD objective back in, passes the
 * pairing check, and then writes the null anyway — the exact silent downgrade
 * the check exists to stop. Presence of the key is the signal, not its value.
 */
export function mergeRedTeamState(
  body: Partial<RedTeamInput>,
  stored: RedTeamInput,
): RedTeamInput {
  const pick = <K extends keyof RedTeamInput>(key: K): RedTeamInput[K] =>
    key in body ? body[key] : stored[key];
  return {
    redTeamStrategy: pick("redTeamStrategy"),
    redTeamTarget: pick("redTeamTarget"),
    redTeamTotalTurns: pick("redTeamTotalTurns"),
    redTeamConfig: pick("redTeamConfig"),
  };
}

/** Whether a write mentions the attack at all. */
export function touchesRedTeam(body: Partial<RedTeamInput>): boolean {
  return (
    "redTeamStrategy" in body ||
    "redTeamTarget" in body ||
    "redTeamTotalTurns" in body ||
    "redTeamConfig" in body
  );
}

/**
 * Turns parsed input into the columns a Prisma write takes, dropping keys the
 * caller did not supply so an update never clears a field it was not asked to.
 */
export function toPrismaRedTeamWrite(input: RedTeamInput) {
  const { redTeamConfig, ...rest } = input;
  return {
    ...(rest.redTeamStrategy !== undefined && {
      redTeamStrategy: rest.redTeamStrategy,
    }),
    ...(rest.redTeamTarget !== undefined && {
      redTeamTarget: rest.redTeamTarget,
    }),
    ...(rest.redTeamTotalTurns !== undefined && {
      redTeamTotalTurns: rest.redTeamTotalTurns,
    }),
    ...toPrismaRedTeamConfig(redTeamConfig),
  };
}
