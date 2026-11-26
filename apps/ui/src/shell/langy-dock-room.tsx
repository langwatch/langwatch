/**
 * The shell's side of the Langy dock handshake: while the navigation shell is
 * mounted it claims the dock, so the panel starts below the header as a second
 * content card, and the content row keeps the dock's room while it is open.
 */

import { setDrawerEndInset } from "@langwatch/design-system/drawer";
import { LANGY_DOCK_WIDTH_PX, langyShellDockInset } from "@langwatch/langy-contract";
import { useLayoutEffect, type ReactNode } from "react";

import { useLangyStore } from "./behavior/langy/langy.store.ts";

function LangyDockRoom({ render }: { render: (inset: number) => ReactNode }) {
  const dockShifted = useLangyStore((store) => store.dockShifted);
  const dockWidthPx = useLangyStore((store) => store.dockWidthPx);
  const dockInset = langyShellDockInset(dockWidthPx);
  const claimDockShell = useLangyStore((store) => store.claimDockShell);
  const releaseDockShell = useLangyStore((store) => store.releaseDockShell);
  useLayoutEffect(() => {
    claimDockShell();
    return releaseDockShell;
  }, [claimDockShell, releaseDockShell]);
  const dockedOpen = useLangyStore((store) => store.isOpen && store.panelMode === "sidebar");
  // A drawer opens beside the docked panel, which drops to its default width there,
  // so the drawer yields that width plus its own margin, never the widened one.
  useLayoutEffect(() => {
    setDrawerEndInset(dockedOpen ? langyShellDockInset(LANGY_DOCK_WIDTH_PX) + 8 : 0);
    return () => setDrawerEndInset(0);
  }, [dockedOpen]);
  return render(dockShifted ? dockInset : 0);
}

export function langyDockRoom({ render }: { render: (inset: number) => ReactNode }): ReactNode {
  return <LangyDockRoom render={render} />;
}
