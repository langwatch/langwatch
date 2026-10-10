/**
 * The shell's side of the Langy dock handshake: while the navigation shell is
 * mounted it claims the dock, so the panel starts below the header as a second
 * content card, and the content row keeps the dock's room while it is open.
 */

import { LANGY_SHELL_DOCK_INSET } from "@langwatch/langy-contract";
import { useLayoutEffect, type ReactNode } from "react";

import { useLangyStore } from "./behavior/langy/langy.store.ts";

function LangyDockRoom({ render }: { render: (inset: number) => ReactNode }) {
  const dockShifted = useLangyStore((store) => store.dockShifted);
  const claimDockShell = useLangyStore((store) => store.claimDockShell);
  const releaseDockShell = useLangyStore((store) => store.releaseDockShell);
  useLayoutEffect(() => {
    claimDockShell();
    return releaseDockShell;
  }, [claimDockShell, releaseDockShell]);
  return render(dockShifted ? LANGY_SHELL_DOCK_INSET : 0);
}

export function langyDockRoom({ render }: { render: (inset: number) => ReactNode }): ReactNode {
  return <LangyDockRoom render={render} />;
}
