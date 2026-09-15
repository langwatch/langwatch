/**
 * The tri-state a "select all" checkbox reports, and the `aria-checked` word
 * that goes with it.
 */

export type CheckboxState = boolean | "indeterminate";

/** None selected, all selected, or somewhere in between. */
export function checkboxStateFor({
  selectedCount,
  total,
}: {
  selectedCount: number;
  total: number;
}): CheckboxState {
  if (selectedCount === 0) return false;
  return selectedCount === total ? true : "indeterminate";
}

/** What `aria-checked` says for each of the three states. */
export function ariaCheckedFor(state: CheckboxState): "true" | "false" | "mixed" {
  if (state === true) return "true";
  return state === false ? "false" : "mixed";
}
