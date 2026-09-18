/**
 * The one statement a request means, whichever of the two ways it was written.
 *
 * A run is always a statement. A request may carry one, or it may carry a
 * shorthand that this expands into one. What it may not carry is both, or
 * neither: a request with both would have a statement whose relationship to
 * the shorthand could not state, and a request with neither has nothing to
 * judge. Both are refused here, before the gate, under the same code the gate
 * itself uses: one code for "this cannot be a run's statement".
 *
 * @see ../shorthand/expand.ts
 * @see ./statement.ts: what the resulting statement then has to clear
 * @see ../../../../../specs/instant-evals/instant-eval-shorthand.feature
 */

import {
  expandInstantEvalShorthand,
  InstantEvalShorthandError,
} from "../shorthand";
import { InstantEvalQueryInvalidError } from "./errors";
import type { InstantEvalRunInput } from "./instant-eval-run.service";

/** The statement to run, and the values it binds. */
export interface InstantEvalStatement {
  readonly sql: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
}

/** Refuses a request that says both of the two things, or neither of them. */
function refuseAmbiguousInput(reason: string): never {
  throw new InstantEvalQueryInvalidError({
    reason,
    fields: ["sql", "target"],
  });
}

/** The caller's own statement, with the values they bound to it. */
function submittedStatement(input: InstantEvalRunInput): InstantEvalStatement {
  return {
    sql: input.sql as string,
    ...(input.parameters ? { parameters: input.parameters } : {}),
  };
}

/** The statement a shorthand becomes, with the expansion's own refusals. */
function expandedStatement({
  input,
  database,
  now,
}: {
  readonly input: InstantEvalRunInput;
  readonly database: string;
  readonly now?: Date;
}): InstantEvalStatement {
  // The expansion writes the parameters as well as the statement, so a
  // caller's own values would have nowhere to go: the statement declares only
  // the window and whatever the filter bound.
  if (input.parameters && Object.keys(input.parameters).length > 0) {
    throw new InstantEvalQueryInvalidError({
      reason:
        "A target writes the statement and its parameters, so there is nothing for parameters to fill. Send a statement of your own to bind your own values.",
      fields: ["parameters"],
    });
  }

  try {
    return expandInstantEvalShorthand({
      shorthand: input.shorthand!,
      database,
      ...(now ? { now } : {}),
    });
  } catch (error) {
    if (!(error instanceof InstantEvalShorthandError)) throw error;
    throw new InstantEvalQueryInvalidError({
      reason: error.message,
      fields: error.fields,
      reasons: [error],
    });
  }
}

export function instantEvalStatementFor({
  input,
  database,
  now,
}: {
  readonly input: InstantEvalRunInput;
  /** The database the LangWatchQL views live in. */
  readonly database: string;
  readonly now?: Date;
}): InstantEvalStatement {
  const hasSql = typeof input.sql === "string" && input.sql.trim() !== "";
  const hasShorthand = input.shorthand !== undefined;

  if (hasSql && hasShorthand) {
    refuseAmbiguousInput(
      "A run takes a statement or a target, not both. Send sql to run a statement you wrote, or target with your questions to have one written for you.",
    );
  }
  if (!hasSql && !hasShorthand) {
    refuseAmbiguousInput(
      "A run needs something to judge: send sql with a statement, or target with the questions to ask of each row.",
    );
  }

  return hasSql
    ? submittedStatement(input)
    : expandedStatement({ input, database, ...(now ? { now } : {}) });
}
