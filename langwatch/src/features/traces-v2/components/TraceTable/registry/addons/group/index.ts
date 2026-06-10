import type { TraceGroup } from "../../cells/group/types";
import type { AddonDef } from "../../types";
import { GroupTracesAddon } from "./GroupTracesAddon";

export const groupAddons: Record<string, AddonDef<TraceGroup>> = {
  [GroupTracesAddon.id]: GroupTracesAddon,
};
