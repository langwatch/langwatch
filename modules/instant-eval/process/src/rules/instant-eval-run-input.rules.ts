/**
 * The one statement a request means, whichever of the two ways it was written.
 * Both at once could not state their relationship and neither has nothing to
 * judge, so each is refused before the gate, under the gate's own code.
 * @see specs/instant-evals/instant-eval-shorthand.feature
 */

import {
  InstantEvalQueryInvalidError,
  type InstantEvalRunInput,
  type InstantEvalRunInputBody,
  type InstantEvalShorthandInput,
} from "@langwatch/instant-eval-contract";
import type { Instant } from "@langwatch/time";

import {
  type CompiledInstantEvalFilter,
  expandInstantEvalShorthand,
} from "./instant-eval-shorthand.rules.ts";

/** The statement to run, and the values it binds. */
export interface InstantEvalStatement {
  readonly sql: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
}

/** Which of the two ways a request asked, once it is known to be only one. */
type InstantEvalStatementSource =
  | Readonly<{ kind: "sql"; sql: string }>
  | Readonly<{ kind: "shorthand"; shorthand: InstantEvalShorthandInput }>;

/** Refuses a request that says both of the two things, or neither of them. */
function refuseAmbiguousInput(reason: string): never {
  throw new InstantEvalQueryInvalidError({ reason, fields: ["sql", "target"] });
}

/**
 * The expansion writes the parameters as well as the statement, so a caller's
 * own values would have nowhere to go: the statement declares only the window
 * and whatever the filter bound.
 */
function refuseCallerParameters(parameters: Readonly<Record<string, unknown>> | undefined): void {
  if (!parameters) return;
  if (Object.keys(parameters).length === 0) return;

  throw new InstantEvalQueryInvalidError({
    reason:
      "A target writes the statement and its parameters, so there is nothing for parameters to fill. Send a statement of your own to bind your own values.",
    fields: ["parameters"],
  });
}

/** The single source the request named, refusing both of them and neither. */
function statementSourceOf(input: InstantEvalRunInput): InstantEvalStatementSource {
  const sql = typeof input.sql === "string" && input.sql.trim() !== "" ? input.sql : undefined;
  const { shorthand } = input;

  if (sql !== undefined && shorthand !== undefined) {
    refuseAmbiguousInput(
      "A run takes a statement or a target, not both. Send sql to run a statement you wrote, or target with your questions to have one written for you.",
    );
  }
  if (sql !== undefined) return { kind: "sql", sql };
  if (shorthand !== undefined) return { kind: "shorthand", shorthand };

  return refuseAmbiguousInput(
    "A run needs something to judge: send sql with a statement, or target with the questions to ask of each row.",
  );
}

export function instantEvalStatementFor({
  input,
  database,
  now,
  filter,
  selection,
}: {
  readonly input: InstantEvalRunInput;
  /** The database the LangWatchQL views live in. */
  readonly database: string;
  readonly now: Instant;
  /** The target's trace filter, already compiled against the trace view. */
  readonly filter?: CompiledInstantEvalFilter | null;
  /** Trace ids to bind in place of a filter the dialect cannot compile. */
  readonly selection?: readonly string[];
}): InstantEvalStatement {
  const source = statementSourceOf(input);
  if (source.kind === "sql") {
    return {
      sql: source.sql,
      ...(input.parameters ? { parameters: input.parameters } : {}),
    };
  }

  refuseCallerParameters(input.parameters);

  return expandInstantEvalShorthand({
    shorthand: source.shorthand,
    database,
    now,
    ...(filter ? { filter } : {}),
    ...(selection ? { selection } : {}),
  });
}

/**
 * The flat body a door accepts, as the run service takes it: a caller writes
 * flat keys on a command line, and a target with no questions is not a
 * shorthand, so the service takes that half as one object.
 */
export function instantEvalRunInputOf(body: InstantEvalRunInputBody): InstantEvalRunInput {
  return {
    ...(body.sql === undefined ? {} : { sql: body.sql }),
    ...(body.parameters === undefined ? {} : { parameters: body.parameters }),
    ...(body.name === undefined ? {} : { name: body.name }),
    ...(body.limit === undefined ? {} : { limit: body.limit }),
    ...(body.target === undefined
      ? {}
      : {
          shorthand: {
            target: body.target,
            questions: body.questions ?? [],
            ...(body.filter === undefined ? {} : { filter: body.filter }),
            ...(body.start === undefined ? {} : { start: body.start }),
            ...(body.end === undefined ? {} : { end: body.end }),
          },
        }),
  };
}
