/**
 * "Board › Widget" under an insight's title. Analytics lends the trail (§10.1) and decides
 * what still links; where nothing lends it, or while it loads, the names read as filed.
 */

import { DashboardPointerToken } from "@langwatch/analytics-client";
import { Lent } from "@langwatch/browser-host/lent";
import { Text } from "@langwatch/design-system/primitives";
import type { InsightBoard } from "@langwatch/insight-contract";

import { boardTrailWords } from "../../model/insight-presentation.ts";

export function InsightBoardTrail({ board }: { board: InsightBoard }) {
  return (
    <Lent
      of={DashboardPointerToken}
      props={{
        boardId: board.id,
        boardName: board.name,
        ...(board.widget ? { widget: board.widget } : {}),
      }}
      fallback={
        <Text as="span" truncate maxWidth="full">
          {boardTrailWords(board)}
        </Text>
      }
    />
  );
}
