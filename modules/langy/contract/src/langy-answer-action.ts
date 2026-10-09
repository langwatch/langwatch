/**
 * The row under a settled Langy answer, where any module may lend an action ("Save as
 * insight"). An extension point: Langy reads every lender and knows none of them (§10.1).
 */

import { uiTokens } from "@langwatch/module";

/** The answer an action is about, as the reader sees it once the turn has settled. */
export type LangyAnswerActionProps = {
  projectId: string;
  conversationId: string | null;
  messageId: string;
  /** The answer's prose, with narration and directives already stripped. */
  answerText: string;
};

export const LangyAnswerActionToken =
  uiTokens("langy").extension<LangyAnswerActionProps>("answerAction");
