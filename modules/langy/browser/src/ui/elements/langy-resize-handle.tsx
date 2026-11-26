import { chakra } from "@langwatch/design-system/primitives";
import type { ComponentProps } from "react";

const HANDLE_WIDTH_PX = 10;
const SHOWN = { opacity: 1 } as const;

/**
 * The drag strip on a panel's free vertical edge. Invisible until pointed at, focused or
 * dragged, when a thin accent line shows where to grab. Behaviour comes from `useLangyPanelResize`.
 * Spec: specs/langy/langy-panel-layout.feature
 */
export function LangyResizeHandle({
  edge,
  active,
  ...handleProps
}: { edge: "left" | "right"; active: boolean } & ComponentProps<typeof chakra.div>) {
  return (
    <chakra.div
      {...handleProps}
      data-langy-resize-handle=""
      data-resizing={active ? "" : undefined}
      position="absolute"
      top={0}
      bottom={0}
      {...{ [edge]: 0 }}
      width={`${HANDLE_WIDTH_PX}px`}
      zIndex={4}
      cursor="col-resize"
      // Without this the browser claims the gesture for scrolling and the drag never arrives.
      touchAction="none"
      outline="none"
      _before={{
        content: '""',
        position: "absolute",
        top: "12px",
        bottom: "12px",
        left: `${HANDLE_WIDTH_PX / 2 - 1}px`,
        width: "2px",
        borderRadius: "full",
        background: "orange.emphasized",
        opacity: active ? 1 : 0,
        transition: "opacity 120ms ease",
      }}
      _hover={{ _before: SHOWN }}
      _focusVisible={{ _before: SHOWN }}
    />
  );
}
