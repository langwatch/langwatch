// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { Collapsible, HStack, VStack } from "@langwatch/design-system/primitives";
import { SmallLabel } from "@langwatch/design-system/small-label";
import { ChevronDown } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

/**
 * The one collapsed group a source drawer offers.
 *
 * Unmounted while closed, so the collapsed state genuinely holds nothing the
 * admin needs: create must produce a working source without it ever being
 * opened. Which is also the constraint on what goes in — anything here that
 * kept its own state would throw the admin's choice away on every collapse,
 * so every child is driven from the drawer's state.
 *
 * Extracted rather than left inside `ParserConfigFields` because the edit
 * drawer reaches the group down a path that renders no parser fields at all:
 * the two source types that route conversations are both absent from
 * `EDITABLE_PULL_CONFIG_SOURCE_TYPES`, so their destination has to be grouped
 * by something that does not belong to the parser config.
 */
export function AdvancedSettingsGroup({
  children,
  openWhen = false,
}: {
  children: ReactNode;
  /**
   * A demand from outside that the group be open — raised when a refused save
   * marked a field inside it.
   *
   * One-way on purpose. It opens the group and never closes it, so a caller
   * whose demand goes away does not slam shut a group the admin has since
   * opened for themselves. Expansion otherwise stays this component's own
   * business, which is what lets the caller with nothing to demand render it
   * with no props at all.
   */
  openWhen?: boolean;
}) {
  const [isOpen, setOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (openWhen) setOpen(true);
  }, [openWhen]);

  // The trigger sits at the bottom of a drawer that is already taller than its
  // viewport, so expanding it otherwise opens the settings below the fold and
  // leaves the admin looking at the button they just pressed, with no sign
  // anything happened. Deferred one frame because the collapsible measures its
  // content on the tick it opens, and a scroll issued before that measurement
  // lands against the collapsed height.
  useEffect(() => {
    if (!isOpen) return;
    const frame = requestAnimationFrame(() => {
      contentRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [isOpen]);

  return (
    <Collapsible.Root
      // Still unmounted while closed, which is what the rule above about
      // caller-owned state pays for. The model-provider drawer this is
      // modelled on keeps its content mounted; matching its LOOK is the point,
      // not its mounting, and mounting a dozen hidden inputs into every source
      // drawer would buy nothing.
      lazyMount
      unmountOnExit
      open={isOpen}
      onOpenChange={({ open }) => setOpen(open)}
      borderTopWidth="1px"
      borderColor="border.muted"
    >
      {/* A full-width row with the label on the left and the chevron on the
          right, matching the model-provider drawer's Advanced section. It read
          as a small grey button before, which put the one control on the form
          that opens more form in the same visual class as Cancel. */}
      <Collapsible.Trigger
        width="full"
        paddingY={2}
        cursor="pointer"
        _hover={{ "& svg": { color: "fg" } }}
      >
        <HStack width="full" justify="space-between">
          <SmallLabel>Advanced</SmallLabel>
          <ChevronDown
            size={14}
            // Rotated rather than swapped for a second glyph, so the open and
            // closed states are the same shape turning and not two icons an
            // eye has to tell apart.
            style={{
              color: "var(--chakra-colors-fg-muted)",
              transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 150ms ease",
            }}
          />
        </HStack>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <VStack ref={contentRef} align="stretch" gap={3} paddingTop={2} paddingBottom={2}>
          {children}
        </VStack>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
