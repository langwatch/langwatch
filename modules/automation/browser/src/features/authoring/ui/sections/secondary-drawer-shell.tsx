import { Button, Heading, HStack, Spacer } from "@chakra-ui/react";
import { Drawer } from "@langwatch/design-system/drawer";
import { ArrowLeft, Maximize2, Minimize2 } from "lucide-react";
import { type ReactNode, useState } from "react";

// Chakra v3's Drawer accepts xs|sm|md|lg|xl|full but not 2xl. Use `full`
// for the expanded width — it pins the drawer to the viewport which is
// what the editor-mode wants anyway, and avoids the unsupported size.
type DrawerSize = "md" | "lg" | "xl" | "full";

// Reusable shell for secondary drawers with optional width-toggle between default and
// full-bleed modes; width preference resets on drawer reopen.
export function SecondaryDrawerShell({
  open,
  title,
  onClose,
  onDone,
  doneDisabled = false,
  headerRight,
  size = "xl",
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  onDone: () => void;
  /** Disables the footer Done action — e.g. a required field isn't set yet. */
  doneDisabled?: boolean;
  headerRight?: ReactNode;
  size?: DrawerSize;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const effectiveSize: DrawerSize = expanded ? "full" : size;

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
            <Button variant="ghost" size="sm" aria-label="Back" onClick={onClose}>
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
            <Button colorPalette="orange" onClick={onDone} disabled={doneDisabled}>
              Done
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
