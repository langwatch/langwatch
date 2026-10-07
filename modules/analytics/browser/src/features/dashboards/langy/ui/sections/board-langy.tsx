/**
 * The ask bar on a board. Where the board takes widgets, typing opens "Add a widget" with the
 * text, with or without Langy; "Ask" and the empty board's chips go to Langy, when the member
 * has it. A read-only board without Langy shows no bar.
 */

import type { BoardPeriod } from "../../../model/board-period.ts";
import { useLangyAsk } from "../../behavior/use-board-langy.ts";
import { type BoardSubject, boardQuestion, SUGGESTED_QUESTIONS } from "../../model/board-langy.ts";
import { BoardAskBar } from "../blocks/board-ask-bar.tsx";

export function BoardLangy({
  board,
  period,
  withSuggestions = false,
  onOpenPicker,
}: {
  board: BoardSubject;
  period: BoardPeriod;
  /** On an empty board: the suggested questions under the bar. */
  withSuggestions?: boolean;
  /** Absent on a read-only board, which takes no widgets. */
  onOpenPicker?: (search: string) => void;
}) {
  const langy = useLangyAsk();
  if (!langy.enabled && !onOpenPicker) return null;
  const onAsk = langy.enabled
    ? (question: string) =>
        langy.ask(
          boardQuestion({
            question: question || "What should I look at on this dashboard?",
            board,
            period,
          }),
        )
    : void 0;
  return (
    <BoardAskBar
      chips={withSuggestions ? SUGGESTED_QUESTIONS : []}
      onType={onOpenPicker}
      onAsk={onAsk}
    />
  );
}
