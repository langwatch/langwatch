import { createContext, useContext } from "react";

interface CommandBarContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  query: string;
  setQuery: (query: string) => void;
  /**
   * Tell the provider that this page already shows the palette in place.
   *
   * Where one is mounted, Cmd+K puts the caret in it rather than raising a
   * second, identical bar over the top of it. Returns the unregister function.
   */
  registerInlinePalette: (focus: () => void) => () => void;
}

export const CommandBarContext = createContext<CommandBarContextValue | null>(
  null
);

export function useCommandBar() {
  const context = useContext(CommandBarContext);
  if (!context) {
    throw new Error("useCommandBar must be used within a CommandBarProvider");
  }
  return context;
}
