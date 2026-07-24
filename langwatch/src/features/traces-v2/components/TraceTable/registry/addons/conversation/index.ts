import type { ConversationGroup } from "../../../conversationGroups";
import type { AddonDef } from "../../types";
import { ConversationTurnsAddon } from "./ConversationTurnsAddon";

export const conversationAddons: Record<string, AddonDef<ConversationGroup>> = {
  [ConversationTurnsAddon.id]: ConversationTurnsAddon,
};
