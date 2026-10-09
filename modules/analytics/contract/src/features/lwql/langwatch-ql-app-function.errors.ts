/**
 * Hydration-stage refusals: too many distinct keys, too many bytes behind
 * them, a read or computation that broke, and a deployment whose projection
 * UDFs were never applied. @see specs/lwql/app-functions.feature
 */
import { HandledError, remediation } from "@langwatch/handled-error";

/**
 * More distinct keys of one kind than one execution may hydrate. A refusal, not
 * a partial answer: a result that hydrated the first thousand keys and left the
 * rest as raw ids looks complete, and an analytics caller cannot detect that.
 */
export class LangWatchQLAppFunctionKeyCapError extends HandledError {
  declare readonly code: "lwql_app_function_key_cap";

  constructor({
    keyKind,
    cap,
    distinct,
    functions,
  }: {
    /** Which cap this is: `trace`, `thread`, `span` or `text`. */
    readonly keyKind: string;
    readonly cap: number;
    /** How many distinct keys of that kind the result carried. */
    readonly distinct: number;
    /** The functions of that kind the statement called, sorted. */
    readonly functions: readonly string[];
  }) {
    super(
      "lwql_app_function_key_cap",
      "The query asks for more conversations, traces or spans than one run may read. Narrow it with a smaller LIMIT or a coarser grouping.",
      {
        httpStatus: 422,
        fault: "customer",
        // Named consumer: the agent that wrote the SQL, which needs the number
        // to lower its LIMIT to and the functions to know which call cost it.
        meta: { keyKind, cap, distinct, functions },
        ...remediation("lwql_app_function_key_cap"),
      },
    );
    this.name = "LangWatchQLAppFunctionKeyCapError";
  }
}

/**
 * The traces the keys name weigh more than one hydration may read. The key cap
 * bounds how many traces a run names; this bounds what they weigh, because a
 * page under the cap can still name gigabytes of stored content.
 */
export class LangWatchQLAppFunctionReadBudgetError extends HandledError {
  declare readonly code: "lwql_app_function_read_budget";

  constructor({
    budgetBytes,
    readBytes,
  }: {
    readonly budgetBytes: number;
    /** How many bytes had been read when the budget was passed. */
    readonly readBytes: number;
  }) {
    super(
      "lwql_app_function_read_budget",
      "The query asks for more trace content than one run may read. Narrow it with a smaller LIMIT or run it in pages.",
      {
        httpStatus: 422,
        fault: "customer",
        // Named consumer: the agent that wrote the SQL, which sizes its pages
        // by the budget. Both numbers are about the caller's own data.
        meta: { budgetBytes, readBytes },
        ...remediation("lwql_app_function_read_budget"),
      },
    );
    this.name = "LangWatchQLAppFunctionReadBudgetError";
  }
}

/**
 * The query ran but the values its app functions asked for could not be read. A
 * platform fault: the statement passed every gate, and degrading into null
 * columns would read as "these conversations are empty".
 */
export class LangWatchQLAppFunctionHydrationFailedError extends HandledError {
  declare readonly code: "lwql_app_function_hydration_failed";

  constructor(options: { reasons?: readonly Error[] } = {}) {
    super(
      "lwql_app_function_hydration_failed",
      "The query ran, but the conversation or trace content it asked for could not be read.",
      {
        httpStatus: 503,
        fault: "platform",
        ...remediation("lwql_app_function_hydration_failed"),
        ...options,
      },
    );
    this.name = "LangWatchQLAppFunctionHydrationFailedError";
  }
}

/**
 * The server does not hold the projection UDF behind an app function, so the
 * deployment's app functions were never applied. Its own code beside
 * provisioning's: that one is about a dataset's grants, and the copy differs.
 */
export class LangWatchQLAppFunctionUnavailableError extends HandledError {
  declare readonly code: "lwql_app_function_unavailable";

  constructor(options: { reasons?: readonly Error[] } = {}) {
    super(
      "lwql_app_function_unavailable",
      "The functions this query uses are not available on this deployment yet.",
      {
        httpStatus: 503,
        fault: "platform",
        ...remediation("lwql_app_function_unavailable"),
        ...options,
      },
    );
    this.name = "LangWatchQLAppFunctionUnavailableError";
  }
}
