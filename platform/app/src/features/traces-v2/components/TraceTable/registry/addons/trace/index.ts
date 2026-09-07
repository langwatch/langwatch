import type { TraceListItem } from "../../../../../types/trace";
import type { AddonDef } from "../../types";
import { ErrorDetailAddon } from "./ErrorDetailAddon";
import { ExpandedPeekAddon } from "./ExpandedPeekAddon";
import { IOPreviewAddon } from "./IOPreviewAddon";

export const traceAddons: Record<string, AddonDef<TraceListItem>> = {
  [IOPreviewAddon.id]: IOPreviewAddon,
  [ExpandedPeekAddon.id]: ExpandedPeekAddon,
  [ErrorDetailAddon.id]: ErrorDetailAddon,
};
