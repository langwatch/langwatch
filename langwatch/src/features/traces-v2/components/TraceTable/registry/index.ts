import type { TraceListItem } from "../../../types/trace";
import type { ConversationGroup } from "../conversationGroups";
import { conversationAddons } from "./addons/conversation";
import { groupAddons } from "./addons/group";
import { traceAddons } from "./addons/trace";
import { conversationCells } from "./cells/conversation";
import { groupCells } from "./cells/group";
import type { TraceGroup } from "./cells/group/types";
import { traceCells } from "./cells/trace";
import type { Registry } from "./types";

export const traceRegistry: Registry<TraceListItem> = {
  rowKind: "trace",
  cells: traceCells,
  addons: traceAddons,
};

export const conversationRegistry: Registry<ConversationGroup> = {
  rowKind: "conversation",
  cells: conversationCells,
  addons: conversationAddons,
};

export const groupRegistry: Registry<TraceGroup> = {
  rowKind: "group",
  cells: groupCells,
  addons: groupAddons,
};

export {
  buildGroups,
  type GroupBy,
  type TraceGroup,
} from "./cells/group/types";
export {
  type ExpandedColumn,
  expandTraceColumns,
  traceComfortableExpanders,
} from "./expanders";
export { RegistryRow } from "./RegistryRow";
export type {
  AddonDef,
  CellDef,
  CellRenderContext,
  Registry,
  RowActions,
  RowKind,
} from "./types";
