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
 * ## The selection fallback
 *
 * The shorthand dialect answers about half the filter language, the half the
 * LangWatchQL trace view carries, and refuses the rest by name. The Explorer
 * writes the other half all the time (an evaluator verdict, an event, a span
 * attribute), and a run started from its search bar has to judge exactly the
 * rows the table shows. So when the dialect refuses a field and the caller
 * gave a resolver, the trace ids are resolved once through the explorer's own
 * compiler and bound as a selection, and the statement keeps those ids.
 *
 * @see ../shorthand/expand.ts
 * @see ./statement.ts: what the resulting statement then has to clear
 * @see ../../../../../specs/instant-evals/instant-eval-shorthand.feature
 */

import {
  expandInstantEvalShorthand,
  InstantEvalShorthandError,
  type InstantEvalShorthandInput,
  instantEvalShorthandWindow,
  isShorthandFilterFieldUnsupported,
} from "../shorthand";
import { InstantEvalQueryInvalidError } from "./errors";
import type { InstantEvalRunInput } from "./instant-eval-run.service";

/** The statement to run, and the values it binds. */
export interface InstantEvalStatement {
  readonly sql: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
}

/**
 * Resolves the trace ids a filter the dialect cannot compile selects, through
 * the explorer's own compiler, bounded by the shorthand's window and the run's
 * row cap.
 */
export type InstantEvalSelectionResolver = (args: {
  readonly filter: string;
  readonly window: { readonly from: number; readonly to: number };
}) => Promise<readonly string[]>;

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

/** The expansion's own refusal, under the run's query code. */
function refuseShorthand(error: unknown): never {
  if (!(error instanceof InstantEvalShorthandError)) throw error;
  throw new InstantEvalQueryInvalidError({
    reason: error.message,
    fields: error.fields,
    reasons: [error],
  });
}

/**
 * The statement a shorthand becomes. Throws the expansion's own
 * {@link InstantEvalShorthandError}, which the callers below wrap or act on.
 */
function expandedStatement({
  input,
  database,
  now,
  selection,
}: {
  readonly input: InstantEvalRunInput;
  readonly database: string;
  readonly now?: Date;
  readonly selection?: readonly string[];
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
  return expandInstantEvalShorthand({
    shorthand: input.shorthand as InstantEvalShorthandInput,
    database,
    ...(now ? { now } : {}),
    ...(selection ? { selection } : {}),
  });
}

function refuseAmbiguity(input: InstantEvalRunInput): "sql" | "shorthand" {
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
  return hasSql ? "sql" : "shorthand";
}

export function instantEvalStatementFor({
  input,
  database,
  now,
  selection,
}: {
  readonly input: InstantEvalRunInput;
  /** The database the LangWatchQL views live in. */
  readonly database: string;
  readonly now?: Date;
  /** A resolved selection to bind in place of compiling the shorthand's filter. */
  readonly selection?: readonly string[];
}): InstantEvalStatement {
  if (refuseAmbiguity(input) === "sql") return submittedStatement(input);
  try {
    return expandedStatement({
      input,
      database,
      ...(now ? { now } : {}),
      ...(selection ? { selection } : {}),
    });
  } catch (error) {
    refuseShorthand(error);
  }
}

/**
 * The statement, with the selection fallback: a filter the dialect refuses by
 * field is resolved through `resolveSelection` and bound, when one is given.
 * Every other refusal is the same one {@link instantEvalStatementFor} raises.
 */
export async function resolveInstantEvalStatement({
  input,
  database,
  now,
  resolveSelection,
}: {
  readonly input: InstantEvalRunInput;
  readonly database: string;
  readonly now?: Date;
  readonly resolveSelection?: InstantEvalSelectionResolver;
}): Promise<InstantEvalStatement> {
  if (refuseAmbiguity(input) === "sql") return submittedStatement(input);
  const shorthand = input.shorthand as InstantEvalShorthandInput;
  try {
    return expandedStatement({ input, database, ...(now ? { now } : {}) });
  } catch (error) {
    if (
      !isShorthandFilterFieldUnsupported(error) ||
      !resolveSelection ||
      !shorthand.filter
    ) {
      refuseShorthand(error);
    }
    const window = instantEvalShorthandWindow({
      shorthand,
      ...(now ? { now } : {}),
    });
    const selection = await resolveSelection({
      filter: shorthand.filter,
      window: { from: window.start.getTime(), to: window.end.getTime() },
    });
    return instantEvalStatementFor({
      input,
      database,
      selection,
      ...(now ? { now } : {}),
    });
  }
}
