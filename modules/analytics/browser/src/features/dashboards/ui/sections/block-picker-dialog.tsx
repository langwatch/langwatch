/**
 * The question-first "Add a block" picker: questions grouped by the shape of
 * their answer; choosing one adds its one library block to a board. Opened
 * from the Flight Deck, it asks which board (or a new one) and never adds there.
 */

import { Box, Button, HStack, NativeSelect, Text, VStack } from "@chakra-ui/react";
import { Dialog } from "@langwatch/design-system/dialog";
import { SearchInput } from "@langwatch/design-system/search-input";
import {
  Activity,
  AlertTriangle,
  Coins,
  Cpu,
  DollarSign,
  FlaskConical,
  Gauge,
  GitCompare,
  HelpCircle,
  type LucideIcon,
  MessageSquare,
  Scale,
  TrendingDown,
  XCircle,
} from "lucide-react";
import { useState } from "react";

import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { useBoardBlocks } from "../../behavior/use-board-blocks.ts";
import { useSavedDashboards } from "../../behavior/use-saved-dashboards.ts";
import {
  BLOCK_QUESTION_SECTIONS,
  type BlockQuestion,
  type BlockQuestionIcon,
  type BlockQuestionSection,
  searchBlockQuestions,
} from "../../model/block-questions.ts";
import { dashboardsPath } from "../../model/boards.ts";

const QUESTION_ICONS: Readonly<Record<BlockQuestionIcon, LucideIcon>> = {
  gauge: Gauge,
  activity: Activity,
  trendingDown: TrendingDown,
  coins: Coins,
  messageSquare: MessageSquare,
  alertTriangle: AlertTriangle,
  xCircle: XCircle,
  flaskConical: FlaskConical,
  gitCompare: GitCompare,
  dollarSign: DollarSign,
  cpu: Cpu,
  helpCircle: HelpCircle,
  scale: Scale,
};

/** The destination value that creates a board for the block. */
const NEW_BOARD = "__new__";

export function BlockPickerDialog({
  targetDashboardId,
  onClose,
}: {
  /** The board the block goes on; absent on the Flight Deck, where the member picks one. */
  targetDashboardId?: string;
  onClose: () => void;
}) {
  const host = useAnalyticsHost();
  const saved = useSavedDashboards();
  const boardBlocks = useBoardBlocks();
  const [search, setSearch] = useState("");
  const [chosenDestination, setChosenDestination] = useState<string | undefined>();
  const [isAdding, setIsAdding] = useState(false);

  const destination = chosenDestination ?? saved.boards[0]?.id ?? NEW_BOARD;
  const sections = searchBlockQuestions({ sections: BLOCK_QUESTION_SECTIONS, search });

  const addToDestination = async (question: BlockQuestion) => {
    if (targetDashboardId) {
      const added = await boardBlocks.addBlock({
        dashboardId: targetDashboardId,
        blockId: question.blockId,
      });
      if (added) onClose();
      return;
    }
    const board =
      destination === NEW_BOARD
        ? await saved.createUntitledBoard()
        : saved.boards.find(({ id }) => id === destination);
    if (!board) return;
    const added = await boardBlocks.addBlock({ dashboardId: board.id, blockId: question.blockId });
    if (!added) return;
    host.succeeded({ title: `Added to ${board.name}` });
    host.navigate(dashboardsPath({ projectSlug: saved.projectSlug, dashboardId: board.id }));
  };

  const choose = (question: BlockQuestion) => {
    setIsAdding(true);
    void addToDestination(question).finally(() => setIsAdding(false));
  };

  return (
    <Dialog.Root open size="lg" onOpenChange={({ open }) => !open && onClose()}>
      <Dialog.Content maxHeight="76vh" maxWidth="720px" borderRadius="xl">
        <Dialog.Header borderBottomWidth="1px" paddingX={5} paddingY={3.5}>
          <Dialog.Title fontSize="14px" fontWeight="semibold">
            Add a block
          </Dialog.Title>
          <Dialog.CloseTrigger />
        </Dialog.Header>
        <VStack align="stretch" gap={3} paddingX={5} paddingY={5} borderBottomWidth="1px">
          {!targetDashboardId && (
            <HStack gap={2}>
              <Text fontSize="13px" color="fg.muted" flexShrink={0}>
                Add to
              </Text>
              <NativeSelect.Root size="sm">
                <NativeSelect.Field
                  aria-label="Add to"
                  value={destination}
                  onChange={(event) => setChosenDestination(event.currentTarget.value)}
                >
                  {saved.boards.map((board) => (
                    <option key={board.id} value={board.id}>
                      {board.name}
                    </option>
                  ))}
                  <option value={NEW_BOARD}>A new dashboard</option>
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
            </HStack>
          )}
          <SearchInput
            aria-label="Search questions"
            placeholder="What do you need to know?"
            height="54px"
            borderRadius="2xl"
            fontSize="15px"
            boxShadow="0 1px 4px rgb(16 16 32 / 0.06)"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </VStack>
        <Dialog.Body overflowY="auto" paddingY={5}>
          <VStack align="stretch" gap={6}>
            {sections.map((section) => (
              <QuestionSection
                key={section.id}
                section={section}
                disabled={isAdding}
                onChoose={choose}
              />
            ))}
            {sections.length === 0 && (
              <Text fontSize="13px" color="fg.muted">
                No matching questions.
              </Text>
            )}
          </VStack>
        </Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  );
}

function QuestionSection({
  section,
  disabled,
  onChoose,
}: {
  section: BlockQuestionSection;
  disabled: boolean;
  onChoose: (question: BlockQuestion) => void;
}) {
  return (
    <VStack as="section" aria-label={section.title} align="stretch" gap={1.5}>
      <VStack align="stretch" gap={0.5} paddingX={1}>
        <Text
          fontSize="10.5px"
          fontWeight="semibold"
          letterSpacing="0.09em"
          textTransform="uppercase"
          color={`${section.palette}.fg`}
        >
          {section.title}
        </Text>
        <Text fontSize="12px" lineHeight="relaxed" color="fg.subtle">
          {section.why}
        </Text>
      </VStack>
      {section.questions.map((question) => (
        <QuestionRow
          key={question.id}
          question={question}
          palette={section.palette}
          disabled={disabled}
          onClick={() => onChoose(question)}
        />
      ))}
    </VStack>
  );
}

function QuestionRow({
  question,
  palette,
  disabled,
  onClick,
}: {
  question: BlockQuestion;
  palette: string;
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = QUESTION_ICONS[question.icon];
  return (
    <Button
      variant="outline"
      height="auto"
      justifyContent="flex-start"
      gap={3}
      paddingX={4}
      paddingY={3}
      borderRadius="xl"
      borderColor="border"
      background="bg.panel"
      boxShadow="0 1px 2px rgb(16 16 32 / 0.03)"
      fontWeight="normal"
      _hover={{
        borderColor: "teal.solid/50",
        background: "bg.panel",
        boxShadow: "0 2px 8px rgb(16 16 32 / 0.06)",
      }}
      disabled={disabled}
      onClick={onClick}
    >
      <Box
        display="flex"
        alignItems="center"
        justifyContent="center"
        boxSize={8}
        borderRadius="md"
        background={`${palette}.subtle`}
        color={`${palette}.fg`}
        flexShrink={0}
      >
        <Icon size={16} strokeWidth={2.1} aria-hidden />
      </Box>
      <VStack align="start" gap={0} minWidth={0}>
        <Text fontSize="13px" lineHeight="snug" fontWeight="medium" color="fg" truncate>
          {question.question}
        </Text>
        <Text fontSize="12px" lineHeight="relaxed" color="fg.subtle" truncate>
          {question.why}
        </Text>
      </VStack>
    </Button>
  );
}
