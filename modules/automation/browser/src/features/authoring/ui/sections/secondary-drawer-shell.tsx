import { Drawer } from "@langwatch/design-system/drawer";
import { Button } from "@langwatch/design-system/primitives";
import { Maximize2, Minimize2 } from "lucide-react";
import { type ReactNode, useState } from "react";

type DrawerSize = "md" | "lg" | "xl" | "full";

// Reusable shell for secondary drawers with optional width-toggle between default and
// full-bleed modes; width preference resets on drawer reopen.
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
  const effectiveSize: DrawerSize = expanded ? "full" : size;

  return (
    <Drawer
      open={open}
      size={effectiveSize}
      title={title}
      onClose={onClose}
      onBack={onClose}
      onExitComplete={() => setExpanded(false)}
      headerTools={
        <>
          {headerRight}
          <Button
            variant="ghost"
            size="sm"
            aria-label={expanded ? "Shrink drawer" : "Expand drawer"}
            onClick={() => setExpanded((e) => !e)}
          >
            {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </Button>
        </>
      }
      footer={{
        primaryAction: { label: "Done", "data-testid": "automation-setup-done", onClick: onDone },
      }}
    >
      {children}
    </Drawer>
  );
}
