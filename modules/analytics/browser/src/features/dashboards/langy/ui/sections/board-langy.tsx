/**
 * Langy on a board, only for a member who has it: the ask bar, and after a
 * block is added, an offer to generate insights on it. The offer is a proposal:
 * nothing is asked until the member accepts, and neither ever writes the board.
 */

import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { Sparkles } from "lucide-react";

import type { AnalyticsLangyAskRequest } from "../../../../../model/analytics-host.ts";
import { useBlockData, useSourceConnection } from "../../../blocks/behavior/use-block-data.ts";
import type { BlockPeriod } from "../../../blocks/index.ts";
import type { BoardBlock } from "../../../model/board-blocks.ts";
import { useJustAddedBlock, useLangyAsk } from "../../behavior/use-board-langy.ts";
import { blockInsightsRequest, type BoardSubject, boardQuestion } from "../../model/board-langy.ts";
import { BoardAskBar } from "../blocks/board-ask-bar.tsx";

export function BoardLangy({
  board,
  period,
  projectId,
  watched,
}: {
  board: BoardSubject;
  period: BlockPeriod;
  projectId: string;
  /** The member's own board's blocks, watched for one just added; absent on the Flight Deck. */
  watched?: { blocks: readonly BoardBlock[]; settled: boolean };
}) {
  const langy = useLangyAsk();
  const { justAdded, settle } = useJustAddedBlock({
    blocks: watched?.blocks ?? [],
    settled: watched?.settled ?? false,
  });
  if (!langy.enabled) return null;

  return (
    <VStack align="stretch" gap={0}>
      <BoardAskBar onAsk={(question) => langy.ask(boardQuestion({ question, board, period }))} />
      {justAdded && (
        <InsightsOffer
          key={justAdded.widgetId}
          boardBlock={justAdded}
          boardName={board.name}
          projectId={projectId}
          period={period}
          onAccept={(request) => {
            langy.ask(request);
            settle();
          }}
          onDismiss={settle}
        />
      )}
    </VStack>
  );
}

function InsightsOffer({
  boardBlock,
  boardName,
  projectId,
  period,
  onAccept,
  onDismiss,
}: {
  boardBlock: BoardBlock;
  boardName: string;
  projectId: string;
  period: BlockPeriod;
  onAccept: (request: AnalyticsLangyAskRequest) => void;
  onDismiss: () => void;
}) {
  const { block } = boardBlock;
  const source = useSourceConnection({ projectId, source: block.source });
  // The same read the block itself runs, so it answers from the block's cache.
  const data = useBlockData({ projectId, block, period, enabled: source.connected });
  const rows = data.rows;

  return (
    <Box
      as="section"
      aria-label="Langy proposal"
      marginX="auto"
      marginBottom={4}
      maxWidth="640px"
      width="full"
      borderWidth="1px"
      borderColor="purple.200"
      borderRadius="xl"
      background="purple.50/50"
      paddingX={4}
      paddingY={3}
    >
      <HStack align="start" gap={2.5}>
        <Box as="span" flexShrink={0} color="purple.600" paddingTop="2px" display="flex">
          <Sparkles size={15} aria-hidden />
        </Box>
        <VStack align="stretch" gap={2.5} flex={1} minWidth={0}>
          <Text fontSize="13px" color="fg">
            <b>{block.title}</b> is on {boardName} now. Want me to generate insights on it: what
            stands out, what changed across the period, and what to look at next?
          </Text>
          <HStack gap={2}>
            <Button
              size="xs"
              borderRadius="full"
              colorPalette="purple"
              disabled={!rows}
              onClick={() => {
                if (!rows) return;
                onAccept(blockInsightsRequest({ boardName, block, rows, period }));
              }}
            >
              Generate insights
            </Button>
            <Button size="xs" borderRadius="full" variant="ghost" onClick={onDismiss}>
              Not now
            </Button>
          </HStack>
        </VStack>
      </HStack>
    </Box>
  );
}
