/**
 * The row under a settled Langy answer, where any module may lend an action ("Save as
 * insight"). An extension point: Langy reads every lender and knows none of them (§10.1).
 */

import { uiTokens } from "@langwatch/module";

/**
 * What an answer was about, when the module that asked said so: the board and widget on
 * screen, and the query the answer read with the fixed window it read it over. A portable
 * shape, so an action can keep it without Langy or the asker knowing the action.
 */
export type LangyAnswerSubject = {
  board?: { id: string; name: string; widget?: { id: string; name: string } };
  /** Never a result: the statement, and the dates and values it ran with. */
  evidence?: {
    lwql: string;
    /** Epoch milliseconds, half-open `[start, end)`. */
    window: { start: number; end: number; granularitySeconds: number };
    /** The board's period as it was set, such as "Last 30 days". */
    period?: string;
    parameters?: Readonly<Record<string, string | number | boolean>>;
  };
};

/** The answer an action is about, as the reader sees it once the turn has settled. */
export type LangyAnswerActionProps = {
  projectId: string;
  conversationId: string | null;
  messageId: string;
  /** The answer's prose, with narration and directives already stripped. */
  answerText: string;
  /** Absent while no asking module hands Langy a structured subject for the turn. */
  subject?: LangyAnswerSubject;
};

export const LangyAnswerActionToken =
  uiTokens("langy").extension<LangyAnswerActionProps>("answerAction");
