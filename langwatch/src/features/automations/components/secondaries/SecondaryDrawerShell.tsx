import { Button, HStack, Heading, Spacer } from "@chakra-ui/react";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Drawer } from "~/components/ui/drawer";

/**
 * Common shell for the secondary drawers — back-arrow header, body, and
 * footer with a "Done" action. Caller supplies the title, body, and an
 * optional header-right (e.g. the Conditions Code-mode switch).
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
  size?: "md" | "lg" | "xl" | "2xl";
  children: ReactNode;
}) {
  return (
    <Drawer.Root
      open={open}
      placement="end"
      size={size}
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
