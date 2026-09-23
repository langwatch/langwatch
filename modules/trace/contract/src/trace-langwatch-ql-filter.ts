/**
 * The trace filter language compiled against the LangWatchQL trace view, the
 * dialect an Instant Eval shorthand writes into its own statement.
 * @see specs/instant-evals/instant-eval-shorthand.feature
 */

/** A value the compiled condition binds. */
export type LangWatchQLTraceFilterValue = string | number | boolean;

/**
 * No filter; one condition and its bound values; a field outside the trace row
 * (the explorer's compiler can still select it); or a value the view cannot
 * answer exactly, which only a statement can ask.
 */
export type LangWatchQLTraceFilter =
  | { readonly kind: "empty" }
  | {
      readonly kind: "compiled";
      readonly sql: string;
      readonly parameters: Readonly<Record<string, LangWatchQLTraceFilterValue>>;
    }
  | {
      readonly kind: "unsupported";
      readonly field: string;
      readonly supportedFields: readonly string[];
    }
  | { readonly kind: "refused"; readonly field: string; readonly reason: string };
