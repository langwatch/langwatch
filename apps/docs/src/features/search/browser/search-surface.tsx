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
          backdropFilter="blur(12px) saturate(1.05)"
          background="transparent"
          data-lw-transparent-backdrop="true"
        />
        <RawDialog.Positioner>
          <RawDialog.Content
            background="bg.overlay"
            width={{ base: "calc(100vw - 24px)", md: "680px" }}
            maxWidth="680px"
            marginTop={{ base: "8vh", md: "12vh" }}
            padding={0}
            overflow="hidden"
            borderWidth="1px"
            borderColor="border.subtle"
            borderRadius={{ base: "18px", md: "20px" }}
            boxShadow="0 2px 8px rgba(20, 20, 23, 0.08), 0 24px 70px -20px rgba(20, 20, 23, 0.35)"
            backdropFilter="blur(20px) saturate(1.15)"
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
