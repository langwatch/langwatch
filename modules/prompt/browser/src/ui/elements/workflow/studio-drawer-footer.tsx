import { readSlice } from "@langwatch/browser-host/global-store";
import { WORKFLOW_DRAWER_FOOTER_SLICE } from "@langwatch/workflow-contract";
import { type ReactNode, useEffect } from "react";

type DrawerFooterSlot = { register: (footer: ReactNode) => void };

/** Where no studio drawer is open, a registered footer has nowhere to render. */
const drawerFooterSlot = readSlice<DrawerFooterSlot>({
  name: WORKFLOW_DRAWER_FOOTER_SLICE,
  absent: { register: () => void 0 },
});

/** Lets drawer content register actions in the studio drawer's footer, read from `workflow:drawer-footer`. */
export function useRegisterDrawerFooter(footer: ReactNode): void {
  const register = drawerFooterSlot((state) => state.register);
  useEffect(() => {
    if (footer === null) return;
    register(footer);
    return () => register(null);
  }, [footer, register]);
}
