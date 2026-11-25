import { createContext, useContext } from "react";

/**
 * - `inline`: label and hint on the left, the control on the right; a settings page.
 * - `stacked`: label above the control; a drawer, a dialog, a narrow card.
 */
export type FieldLayout = "inline" | "stacked";

const FieldLayoutContext = createContext<FieldLayout>("inline");

/** Drawer and Dialog content provide `stacked`; a page provides nothing and reads `inline`. */
export const FieldLayoutProvider = FieldLayoutContext.Provider;

export function useFieldLayout(): FieldLayout {
  return useContext(FieldLayoutContext);
}
