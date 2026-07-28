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
 * Deliberately free of any `@prisma/client` value import: `ScenarioForm.tsx`
 * imports `redTeamStateIssue` from here so the editor enforces the same rules
 * as the API, and a value-level Prisma import would drag the client runtime
 * into the browser bundle to do it. The Prisma translation lives next door in
 * `red-team-prisma.ts`, which only the server routes import.
 *
 * @see specs/scenarios/red-team-scenarios.feature
 */
import { z } from "zod";
import {
  RED_TEAM_MAX_TARGET_LENGTH,
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
   *
   * The upper bound matters more than it looks — this string is re-embedded
   * into the attacker's prompt on every one of up to fifty turns, so an
   * unbounded objective is written once and paid for fifty times per run.
   * `RedTeamConfigSchema` bounds the two planner fields for the same reason.
   */
  redTeamTarget: z
    .string()
    .trim()
    .min(1)
    .max(RED_TEAM_MAX_TARGET_LENGTH)
    .nullish(),
  redTeamTotalTurns: z
    .number()
    .int()
    .min(1)
    .max(RED_TEAM_MAX_TURNS)
    .nullish(),
  redTeamConfig: RedTeamConfigSchema.nullish(),
};

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
 * Clearing the strategy clears the whole attack.
 *
 * The editor and `scenario update --standard` both send all four fields as
 * null, so this only ever fires for a hand-written REST call — but the row it
 * leaves behind is a trap either way. `{ redTeamStrategy: null }` on its own
 * validates fine and keeps the objective, the turn budget and the stored
 * config; re-enable red team a month later and a stale objective and a stale
 * attack plan come back with it, and picking GOAT then 400s on a planner
 * setting the user never chose. There is no such thing as an attack
 * configuration with no strategy, so it does not get to persist as one.
 *
 * The spread order lets an explicit value in the same request win: clearing
 * the strategy while deliberately keeping the objective stays expressible.
 */
export function normalizeRedTeamWrite<T extends object>(
  body: T,
): T & Partial<RedTeamInput> {
  // `T extends object` rather than `Partial<RedTeamInput>`: callers pass a
  // whole write body, most of which is not red-team, and constraining to an
  // all-optional type would reject exactly those — a body of only `name` has
  // no property in common with it.
  const write = body as T & Partial<RedTeamInput>;
  if (!("redTeamStrategy" in write) || write.redTeamStrategy !== null) {
    return write;
  }
  return {
    redTeamTarget: null,
    redTeamTotalTurns: null,
    redTeamConfig: null,
    ...write,
  };
}

/**
 * Merge a partial write over what is stored.
 *
 * `??` is wrong here: it treats an explicit `null` as "not supplied", so a
 * request clearing the objective merges the OLD objective back in, passes the
 * pairing check, and then writes the null anyway — the exact silent downgrade
 * the check exists to stop. Presence of the key is the signal, not its value.
 *
 * The signal is presence, which means a key sent as an *explicit* `undefined`
 * reads as "supplied" and merges `undefined` over the stored value — enough to
 * fail the pairing check on a request that changed nothing. Zod does not
 * materialise absent `.nullish()` keys, so nothing reaches this from a parsed
 * body; a caller hand-building the object (`mutate({ redTeamTarget: undefined })`)
 * would. Omit the key instead of spelling it `undefined`.
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
