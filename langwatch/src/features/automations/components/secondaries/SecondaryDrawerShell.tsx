import { Button, HStack, Heading, Spacer } from "@chakra-ui/react";
import { ArrowLeft, Maximize2, Minimize2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Drawer } from "~/components/ui/drawer";

type DrawerSize = "md" | "lg" | "xl" | "2xl";

/**
 * Common shell for the secondary drawers — back-arrow header, body, and
 * footer with a "Done" action. Caller supplies the title, body, and an
 * optional header-right (e.g. the Conditions Code-mode switch).
 *
 * The header carries a width-toggle: clicking the maximise icon expands
 * the drawer to `2xl` (full-bleed for editor work); clicking the
 * minimise icon returns to the default size. The toggle resets when the
 * drawer reopens — width is a transient preference, not a saved one.
 */
export function SecondaryDrawerShell({
  open,
  title,
  onClose,
  onDone,
  headerRight,
  size = "xl",
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  onDone: () => void;
  headerRight?: ReactNode;
  size?: DrawerSize;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const effectiveSize: DrawerSize = expanded ? "2xl" : size;

  return (
    <Drawer.Root
      open={open}
      placement="end"
      size={effectiveSize}
      onExitComplete={() => setExpanded(false)}
      onOpenChange={({ open: o }) => {
        if (!o) onClose();
      }}
    >
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <HStack width="full" gap={3}>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <ArrowLeft size={16} />
            </Button>
            <Heading size="md">{title}</Heading>
            <Spacer />
            {headerRight}
            <Button
              variant="ghost"
              size="sm"
              aria-label={expanded ? "Shrink drawer" : "Expand drawer"}
              onClick={() => setExpanded((e) => !e)}
            >
              {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </Button>
          </HStack>
        </Drawer.Header>
        <Drawer.Body>{children}</Drawer.Body>
        <Drawer.Footer>
          <HStack width="full">
            <Spacer />
            <Button colorPalette="orange" onClick={onDone}>
              Done
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
