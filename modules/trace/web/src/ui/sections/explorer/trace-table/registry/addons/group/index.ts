import type { TraceGroup } from "../../cells/group/types.ts";
import type { AddonDef } from "../../types.ts";
import { GroupTracesAddon } from "./group-traces-addon.tsx";

export const groupAddons: Record<string, AddonDef<TraceGroup>> = {
  [GroupTracesAddon.id]: GroupTracesAddon,
};
