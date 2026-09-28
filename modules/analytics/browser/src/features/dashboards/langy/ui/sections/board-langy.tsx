/**
 * Langy on a board, only for a member who has it: the ask bar, a button that
 * opens the question picker, where every ask starts.
 */

import { useLangyAsk } from "../../behavior/use-board-langy.ts";
import { BoardAskBar } from "../blocks/board-ask-bar.tsx";

export function BoardLangy({ onOpenPicker }: { onOpenPicker: () => void }) {
  const langy = useLangyAsk();
  if (!langy.enabled) return null;
  return <BoardAskBar onOpen={onOpenPicker} />;
}
