/** Maps three distinct states (auto, cleared, set) to one optional string at the boundary. */
export type OutputFieldState =
  | { kind: "auto" }
  | { kind: "cleared" }
  | { kind: "set"; value: string };

/** The agent output used when nothing declares one. */
export const DEFAULT_OUTPUT_IDENTIFIER = "output";

/** Reads the stored shape. Total: every string is one of the three states. */
export const toOutputFieldState = (stored: string | undefined): OutputFieldState => {
  if (stored === undefined) return { kind: "auto" };
  if (stored === "") return { kind: "cleared" };
  return { kind: "set", value: stored };
};

/** Writes the stored shape back, so callers never spell the `""` themselves. */
export const fromOutputFieldState = (state: OutputFieldState): string | undefined => {
  switch (state.kind) {
    case "auto":
      return undefined;
    case "cleared":
      return "";
    case "set":
      return state.value;
  }
};

/** Resolves the editor's output choice to the value shown or null if cleared. */
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
