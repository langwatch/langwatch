import type { TraceListItem } from "../../types/trace";
import type { ConversationGroup } from "../conversation-groups";
import { conversationAddons } from "./addons/conversation";
import { groupAddons } from "./addons/group";
import { traceAddons } from "./addons/trace";
import { conversationCells } from "./cells/conversation";
import { groupCells } from "./cells/group";
import type { TraceGroup } from "./cells/group/types";
import { traceCells } from "./cells/trace";
import type { Registry } from "./types";

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

export { buildGroups, type TraceGroup } from "./cells/group/types";
export { RegistryRow } from "./registry-row";
export type { Registry } from "./types";
