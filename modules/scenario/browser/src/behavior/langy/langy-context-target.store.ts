import { readSlice } from "@langwatch/browser-host/global-store";
import {
  LANGY_ABSENT_CONTEXT_TARGET,
  LANGY_CONTEXT_TARGET_SLICE,
  type LangyContextTargetDescriptor,
  type LangyContextTargetState,
  LANGY_ABSENT_SURFACE,
  LANGY_STORE_SLICE,
  type LangySliceSurface,
} from "@langwatch/langy-contract";

export type { LangyContextChip } from "@langwatch/langy-contract";

/** Langy's panel state, read from the global UI store (`langy:store`); Langy owns the writes. */
export const useLangyStore = readSlice<LangySliceSurface>({
  name: LANGY_STORE_SLICE,
  absent: LANGY_ABSENT_SURFACE,
});

export {
  LANGY_CONTEXT_DRAG_MIME,
  type LangyContextTargetDescriptor,
} from "@langwatch/langy-contract";

/** The page's context targets, read from the global UI store (`langy:context-target`). */
export const useLangyContextTargetStore = readSlice<LangyContextTargetState>({
  name: LANGY_CONTEXT_TARGET_SLICE,
  absent: LANGY_ABSENT_CONTEXT_TARGET,
});

/** Take a page target into Langy's context: pick it, flash it, choose its chip. */
export function absorbContextTarget(target: LangyContextTargetDescriptor): void {
  const targets = useLangyContextTargetStore.getState();
  targets.pick(target);
  targets.flashAbsorb(target.id);
  useLangyStore.getState().chooseChip(target.id);
}

/** The reverse: unpick the target and dismiss its chip. */
export function releaseContextTarget(id: string): void {
  useLangyContextTargetStore.getState().unpick(id);
  useLangyStore.getState().dismissChip(id);
}
