import type { ConversationGroup } from "../../../conversation-groups.ts";
import type { AddonDef } from "../../types.ts";
import { ConversationTurnsAddon } from "./conversation-turns-addon.tsx";

export const conversationAddons: Record<string, AddonDef<ConversationGroup>> = {
  [ConversationTurnsAddon.id]: ConversationTurnsAddon,
};
