import { useState } from "react";
import { Dialog } from "~/components/ui/dialog";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import { useCommandBar } from "./CommandBarContext";
import { CommandPalette } from "./CommandPalette";
import { COMMAND_BAR_MAX_WIDTH, COMMAND_BAR_TOP_MARGIN } from "./constants";

/**
 * The palette raised over the page by Cmd+K.
 *
 * This file is the SURFACE only: a dialog, its entrance, and the way it
 * dissolves when a question is handed to Langy. Everything the palette does —
 * search, navigation, recents, the Langy hand-off — lives in `CommandPalette`,
 * which the project home mounts inline as well. Two places to type, one set of
 * behaviours.
 */
export function CommandBar() {
  const { isOpen, close, query, setQuery } = useCommandBar();
  const reduceMotion = useReducedMotion();
  const [handingOff, setHandingOff] = useState(false);

  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={({ open }) => !open && close()}
      placement="top"
      motionPreset="slide-in-top"
    >
      <Dialog.Content
        background="bg.surface/92"
        width={{ base: "calc(100vw - 24px)", md: COMMAND_BAR_MAX_WIDTH }}
        maxWidth={COMMAND_BAR_MAX_WIDTH}
        marginTop={{ base: "8vh", md: COMMAND_BAR_TOP_MARGIN }}
        padding={0}
        overflow="hidden"
        borderWidth="1px"
        borderColor="border.subtle"
        borderRadius={{ base: "18px", md: "20px" }}
        boxShadow="0 2px 8px rgba(20, 20, 23, 0.08), 0 24px 70px -20px rgba(20, 20, 23, 0.35)"
        backdropFilter="blur(20px) saturate(1.15)"
        backdropProps={{ backdropFilter: "blur(12px) saturate(1.05)" }}
        data-langy-handoff={handingOff ? "exiting" : undefined}
        style={{
          opacity: handingOff ? 0 : 1,
          transform: handingOff
            ? "translate3d(18px, 4px, 0) scale(0.985)"
            : undefined,
          filter: handingOff ? "blur(2px)" : undefined,
          transition: reduceMotion
            ? undefined
            : "opacity 160ms ease, transform 220ms cubic-bezier(0.32, 0.72, 0, 1), filter 160ms ease",
        }}
      >
        <CommandPalette
          surface="dialog"
          active={isOpen}
          query={query}
          setQuery={setQuery}
          onDone={close}
          onHandoffStateChange={setHandingOff}
        />
      </Dialog.Content>
    </Dialog.Root>
  );
}
