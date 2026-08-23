/**
 * The one variable the playground fills in for you.
 *
 * `input` is the message you write in the conversation: the run binds the last
 * message you sent to it, so `{{input}}` in a template renders what you typed.
 * That makes the message box the field for `input`, and the reason it is never
 * offered a second field of its own — two controls for one value is how the
 * playground used to leave people wondering which one the run would use.
 *
 * It stays in the prompt's variable list, because a template that writes
 * `{{input}}` needs it declared. It just cannot be renamed, removed, or given a
 * value anywhere but the message box.
 */
export const CHAT_MESSAGE_VARIABLE = "input";

/** Variables the prompt's own variable list will not let you rename or remove. */
export const LOCKED_VARIABLES = new Set([CHAT_MESSAGE_VARIABLE]);

/** Help text pinned to particular variables in the prompt's variable list. */
export const VARIABLE_INFO: Record<string, string> = {
  [CHAT_MESSAGE_VARIABLE]: "Set by the message you send in the conversation.",
};

/**
 * The values a run is given for the prompt's variables.
 *
 * `input` is always sent empty, whatever is stored against it: the run falls
 * back to the message you sent, and a value left behind by an older version of
 * the playground would otherwise quietly win over what you just typed.
 */
/**
 * The variables the message box offers a field for.
 *
 * Everything the run substitutes except `input`, whose field is the message box
 * itself. A second control for the same value is how the playground used to
 * leave people guessing which one a run would use.
 */
export function composerVariablesFor(
  runtimeVariables: Array<{ identifier: string; value: string }>,
): Array<{ identifier: string; value: string }> {
  return runtimeVariables
    .filter((variable) => variable.identifier !== CHAT_MESSAGE_VARIABLE)
    .map((variable) => ({
      identifier: variable.identifier,
      value: variable.value,
    }));
}

// Generic over the declared type so the prompt's own union survives the round
// trip. Fixing it as `string` here widened every variable, and the chat pane
// that renders a field per type would not take the result.
export function runtimeVariablesFor<TType extends string>({
  declarations,
  values,
}: {
  declarations: Array<{ identifier: string; type: TType }>;
  values: Record<string, string>;
}): Array<{ identifier: string; type: TType; value: string }> {
  return declarations.map((declaration) => ({
    identifier: declaration.identifier,
    type: declaration.type,
    value:
      declaration.identifier === CHAT_MESSAGE_VARIABLE
        ? ""
        : (values[declaration.identifier] ?? ""),
  }));
}
