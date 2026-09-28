/** Board templates: ready boards of stored widgets a member starts a dashboard from. */

import { AGENT_FLIGHT_DECK_TEMPLATE } from "./model/agent-flight-deck-template.ts";
import type { BoardTemplate } from "./model/board-template.ts";
import { QUESTION_TEMPLATES } from "./model/question-templates.ts";

export { AGENT_FLIGHT_DECK_TEMPLATE };
export type {
  BoardTemplate,
  BoardTemplateId,
  BoardTemplateWidget,
} from "./model/board-template.ts";

/** Every template a blank board offers: the Flight Deck, then one per picker section. */
export const BOARD_TEMPLATES: readonly BoardTemplate[] = [
  AGENT_FLIGHT_DECK_TEMPLATE,
  ...QUESTION_TEMPLATES,
];
