import type { ConversationGroup } from "../../../conversation-groups";
import type { AddonDef } from "../../types";
import { ConversationTurnsAddon } from "./conversation-turns-addon";

export const conversationAddons: Record<string, AddonDef<ConversationGroup>> = {
  [ConversationTurnsAddon.id]: ConversationTurnsAddon,
};
