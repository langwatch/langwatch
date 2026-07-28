/**
 * The Prisma half of the red-team write contract.
 *
 * Split from `red-team-input.ts` because that module is imported by
 * `ScenarioForm.tsx` — the editor validates with the same `redTeamStateIssue`
 * the API enforces, which is the point — and a value-level
 * `import { Prisma } from "@prisma/client"` there would pull the Prisma
 * runtime into the browser bundle to get one sentinel. Only server routes
 * import this file.
 *
 * @see specs/scenarios/red-team-scenarios.feature
 */
import { Prisma } from "@prisma/client";
import type { RedTeamConfig } from "./execution/types";
import type { RedTeamInput } from "./red-team-input";

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
