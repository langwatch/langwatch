import type { TraceListItem } from "../../../../types/trace";
import type { AddonDef } from "../../types";
import { ErrorDetailAddon } from "./error-detail-addon";
import { ExpandedPeekAddon } from "./expanded-peek-addon";
import { IOPreviewAddon } from "./io-preview-addon";

export const traceAddons: Record<string, AddonDef<TraceListItem>> = {
  [IOPreviewAddon.id]: IOPreviewAddon,
  [ExpandedPeekAddon.id]: ExpandedPeekAddon,
  [ErrorDetailAddon.id]: ErrorDetailAddon,
};
