/**
 * The ask bar on a board. Where the board takes widgets, a click opens "Add a widget", with
 * or without Langy; on a read-only board it opens Langy about the board. The empty board's
 * chips ask Langy, when the member has it. A read-only board without Langy shows no bar.
 */

import type { BoardPeriod } from "../../../model/board-period.ts";
import { useLangyAsk } from "../../behavior/use-board-langy.ts";
import {
  type BoardSubject,
  boardOpen,
  boardQuestion,
  SUGGESTED_QUESTIONS,
} from "../../model/board-langy.ts";
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
  onOpenPicker?: () => void;
}) {
  const langy = useLangyAsk();
  const onAsk = langy.enabled
    ? (question: string) => langy.ask(boardQuestion({ question, board, period }))
    : void 0;
  const chips = withSuggestions ? SUGGESTED_QUESTIONS : [];
  if (onOpenPicker) {
    return <BoardAskBar onOpen={onOpenPicker} chips={chips} onAsk={onAsk} />;
  }
  if (!langy.enabled) return null;
  return (
    <BoardAskBar
      onOpen={() => langy.ask(boardOpen({ board, period }))}
      chips={chips}
      onAsk={onAsk}
    />
  );
}
