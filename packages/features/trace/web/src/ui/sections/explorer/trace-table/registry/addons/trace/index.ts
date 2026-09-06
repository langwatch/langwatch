import type { TraceListItem } from "../../../../types/trace.ts";
import type { AddonDef } from "../../types.ts";
import { ErrorDetailAddon } from "./error-detail-addon.tsx";
import { ExpandedPeekAddon } from "./expanded-peek-addon.tsx";
import { IOPreviewAddon } from "./io-preview-addon.tsx";

export const traceAddons: Record<string, AddonDef<TraceListItem>> = {
  [IOPreviewAddon.id]: IOPreviewAddon,
  [ExpandedPeekAddon.id]: ExpandedPeekAddon,
  [ErrorDetailAddon.id]: ErrorDetailAddon,
};
