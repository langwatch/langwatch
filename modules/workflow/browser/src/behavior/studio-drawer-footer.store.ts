import { defineSlice } from "@langwatch/browser-host/global-store";
import { WORKFLOW_DRAWER_FOOTER_SLICE } from "@langwatch/workflow-contract";
import type { ReactNode } from "react";

export interface StudioDrawerFooterState {
  register: (footer: ReactNode) => void;
}

const nowhere = (): void => void 0;

/** `workflow:drawer-footer`: the open studio drawer wrapper points `register` at its footer. */
export const studioDrawerFooterSlice = defineSlice<StudioDrawerFooterState>({
  name: WORKFLOW_DRAWER_FOOTER_SLICE,
  create: () => ({ register: nowhere }),
});

export function offerStudioDrawerFooter(register: StudioDrawerFooterState["register"]): () => void {
  studioDrawerFooterSlice.setState({ register });
  return () => studioDrawerFooterSlice.setState({ register: nowhere });
}
