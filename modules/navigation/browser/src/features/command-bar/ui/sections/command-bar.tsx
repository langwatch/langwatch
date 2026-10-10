import { CommandBarSurface } from "@langwatch/design-system/app-shell";
import { useState } from "react";

import { useCommandBar } from "../../behavior/command-bar-context.ts";
import {
  COMMAND_BAR_MAX_WIDTH,
  COMMAND_BAR_TOP_MARGIN,
} from "../../model/command-bar-constants.ts";
import { CommandPalette } from "./command-palette.tsx";

/** Cmd+K palette surface. Behaviors live in CommandPalette component. */
export function CommandBar() {
  const { isOpen, close, query, setQuery } = useCommandBar();
  const [handingOff, setHandingOff] = useState(false);

  return (
    <CommandBarSurface
      open={isOpen}
      onClose={close}
      handingOff={handingOff}
      maxWidth={COMMAND_BAR_MAX_WIDTH}
      topMargin={COMMAND_BAR_TOP_MARGIN}
    >
      <CommandPalette
        surface="dialog"
        active={isOpen}
        query={query}
        setQuery={setQuery}
        onDone={close}
        onHandoffStateChange={setHandingOff}
      />
    </CommandBarSurface>
  );
}
