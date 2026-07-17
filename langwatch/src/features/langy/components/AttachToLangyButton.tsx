import { chakra } from "@chakra-ui/react";
import { Paperclip } from "lucide-react";
import type { MouseEvent } from "react";
import { Tooltip } from "~/components/ui/tooltip";

/**
 * The one "attach to Langy" affordance.
 *
 * Wherever you can pull a concrete piece of evidence — a trace filter, an
 * attention-inbox signal, a run — into Langy's context, it wears THIS icon. A
 * paperclip is the universal "attach" metaphor, so the gesture is learnable: see
 * the clip anywhere, know you can click to load that thing into Langy's next
 * turn. That is the whole point of giving it a dedicated glyph instead of a bare
 * "Attach" word that reads like every other text button on the card.
 *
 * It stays a real <button> with an explicit label so it sits correctly inside a
 * clickable row — the caller stops the row's own click so attaching never also
 * navigates.
 */
export function AttachToLangyButton({
  label,
  onClick,
  size = 15,
}: {
  /** Accessible label — describes WHAT gets attached (the row can't). */
  label: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  size?: number;
}) {
  return (
    <Tooltip content="Attach to Langy" positioning={{ placement: "top" }}>
      <chakra.button
        type="button"
        aria-label={label}
        onClick={onClick}
        flexShrink={0}
        display="grid"
        placeItems="center"
        width="26px"
        height="26px"
        borderRadius="7px"
        color="fg.subtle"
        cursor="pointer"
        transition="color 130ms ease, background 130ms ease"
        _hover={{ color: "orange.fg", background: "bg.muted" }}
        _focusVisible={{
          outline: "2px solid",
          outlineColor: "orange.focusRing",
        }}
      >
        <Paperclip size={size} />
      </chakra.button>
    </Tooltip>
  );
}
