import { RawDialog } from "@langwatch/design-system/dialog";
import { Portal } from "@langwatch/design-system/primitives";
import { useReducedMotion } from "@langwatch/design-system/use-reduced-motion";
import type { ReactNode } from "react";

/**
 * The design system's `CommandBarSurface`, open and never handing off, on Chakra's own dialog
 * parts with the same DOM. The shared one goes through the framed `Dialog`, which brings its
 * action rows, menus, tooltips and crash banner into the search download.
 */
export function SearchSurface({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  return (
    <RawDialog.Root
      open
      onOpenChange={({ open }) => !open && onClose()}
      placement="top"
      motionPreset="slide-in-top"
    >
      <Portal>
        <RawDialog.Backdrop
          backdropFilter="blur(2px)"
          background={{ base: "docs.primaryText/30", _dark: "black/60" }}
          data-lw-transparent-backdrop="true"
        />
        <RawDialog.Positioner>
          <RawDialog.Content
            background="docs.raised"
            width={{ base: "calc(100vw - 24px)", md: "680px" }}
            maxWidth="680px"
            marginTop={{ base: "8vh", md: "12vh" }}
            padding={0}
            overflow="hidden"
            borderWidth="1px"
            borderColor={{ base: "border", _dark: "border.emphasized/50" }}
            borderRadius={{ base: "18px", md: "20px" }}
            boxShadow="0 2px 8px {colors.docs.shadow}, 0 28px 80px -16px {colors.docs.shadowStrong}"
            style={{
              opacity: 1,
              transition: reduceMotion
                ? undefined
                : "opacity 160ms ease, transform 220ms cubic-bezier(0.32, 0.72, 0, 1), filter 160ms ease",
            }}
          >
            {children}
            <div data-overlay-portal-target="" />
          </RawDialog.Content>
        </RawDialog.Positioner>
      </Portal>
    </RawDialog.Root>
  );
}
