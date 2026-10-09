/**
 * The three states the scenario output-field selection can be in.
 *
 * The stored shape is one optional string carrying three meanings:
 * `undefined` is "the user has not chosen, fall back to the agent's first
 * output", `""` is "the user cleared it on purpose", and any other string is
 * their choice. Those are three different states, and which was which was
 * carried by a comment rather than by the type:
 *
 *     // undefined = not yet set (auto-populate), "" = explicitly cleared,
 *     // string = user selection
 *
 * so every branch had to re-derive the rule, and an `if (!outputField)` reads
 * as correct while collapsing "not chosen" into "cleared".
 *
 * The stored shape is deliberately unchanged. This is a mapper at the
 * boundary, so the serialized agent config and this component's props stay
 * `string | undefined` and no persisted value has to move. See #3119.
 */
export type OutputFieldState =
  | { kind: "auto" }
  | { kind: "cleared" }
  | { kind: "set"; value: string };

/** The agent output used when nothing declares one. */
export const DEFAULT_OUTPUT_IDENTIFIER = "output";

/** Reads the stored shape. Total: every string is one of the three states. */
export const toOutputFieldState = (
  stored: string | undefined,
): OutputFieldState => {
  if (stored === undefined) return { kind: "auto" };
  if (stored === "") return { kind: "cleared" };
  return { kind: "set", value: stored };
};

/** Writes the stored shape back, so callers never spell the `""` themselves. */
export const fromOutputFieldState = (
  state: OutputFieldState,
): string | undefined => {
  switch (state.kind) {
    case "auto":
      return undefined;
    case "cleared":
      return "";
    case "set":
      return state.value;
  }
};

/**
 * The output this editor shows as mapped, or `null` when the user cleared the
 * selection and the editor should show no mapping row.
 *
 * This is the editor's reading of the stored value, not the executor's. The
 * serialized adapters branch on `if (scenarioOutputField)`, so at execution
 * time `""` takes the same path as `undefined` and falls back to the agent's
 * first declared output. Whether a cleared selection should keep falling back
 * or should mean something else at execution is a behaviour question this
 * refactor deliberately does not answer.
 */
export const resolveOutputField = ({
  state,
  firstDeclaredOutput,
}: {
  state: OutputFieldState;
  /** The first output the agent declares, used when nothing was chosen. */
  firstDeclaredOutput: string | undefined;
}): string | null => {
  switch (state.kind) {
    case "cleared":
      return null;
    case "set":
      return state.value;
    case "auto":
      return firstDeclaredOutput ?? DEFAULT_OUTPUT_IDENTIFIER;
  }
};
