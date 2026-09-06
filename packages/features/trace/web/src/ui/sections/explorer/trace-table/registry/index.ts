import type { TraceListItem } from "../../types/trace.ts";
import type { ConversationGroup } from "../conversation-groups.ts";
import { conversationAddons } from "./addons/conversation/index.ts";
import { groupAddons } from "./addons/group/index.ts";
import { traceAddons } from "./addons/trace/index.ts";
import { conversationCells } from "./cells/conversation/index.ts";
import { groupCells } from "./cells/group/index.ts";
import type { TraceGroup } from "./cells/group/types.ts";
import { traceCells } from "./cells/trace/index.ts";
import type { Registry } from "./types.ts";

export const traceRegistry: Registry<TraceListItem> = {
  cells: traceCells,
  addons: traceAddons,
};

export const conversationRegistry: Registry<ConversationGroup> = {
  cells: conversationCells,
  addons: conversationAddons,
};

export const groupRegistry: Registry<TraceGroup> = {
  cells: groupCells,
  addons: groupAddons,
};

export { buildGroups, type TraceGroup } from "./cells/group/types.ts";
export { RegistryRow } from "./registry-row.tsx";
export type { Registry } from "./types.ts";
