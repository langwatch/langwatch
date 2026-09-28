/**
 * The "Add a block" picker. With Langy, a question closes it and asks Langy with the board
 * attached, writing nothing; a pinned footer always offers to ask Langy anything else.
 * "Blocks" adds a library block; from the Flight Deck it asks which board gets it.
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
  LayoutGrid,
  type LucideIcon,
  MessageSquare,
  Scale,
  Sparkles,
  TrendingDown,
  XCircle,
} from "lucide-react";
import { useState } from "react";

import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { useBoardBlocks } from "../../behavior/use-board-blocks.ts";
import { useSavedDashboards } from "../../behavior/use-saved-dashboards.ts";
import type { BlockDefinition, BlockPeriod } from "../../blocks/index.ts";
import { useLangyAsk } from "../../langy/behavior/use-board-langy.ts";
import {
  type BoardSubject,
  boardPromptQuestion,
  boardQuestion,
} from "../../langy/model/board-langy.ts";
import {
  BLOCK_QUESTION_SECTIONS,
  type BlockQuestion,
  type BlockQuestionIcon,
  type BlockQuestionSection,
  searchBlockQuestions,
  searchLibraryBlocks,
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
  board,
  period,
  onClose,
}: {
  /** The board the picker opened on; a read-only one sends blocks to a board the member picks. */
  board: BoardSubject;
  period: BlockPeriod;
  onClose: () => void;
}) {
  const langy = useLangyAsk();
  const [search, setSearch] = useState("");

  const sections = langy.enabled
    ? searchBlockQuestions({ sections: BLOCK_QUESTION_SECTIONS, search })
    : [];
  const blocks = searchLibraryBlocks(search);
  const typed = search.trim();
  const hasMatches = sections.length > 0 || blocks.length > 0;
  const canAskOnEnter = langy.enabled && !hasMatches && typed.length > 0;

  const ask = (question: BlockQuestion) => {
    langy.ask(boardPromptQuestion({ prompt: question.prompt, board, period }));
    onClose();
  };

  const askLangy = (text: string) => {
    const question = text.trim() === "" ? "Help me build a dashboard" : text;
    langy.ask(boardQuestion({ question, board, period }));
    onClose();
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
          <SearchInput
            aria-label={langy.enabled ? "Search questions and blocks" : "Search blocks"}
            placeholder={langy.enabled ? "What do you need to know?" : "Search blocks"}
            height="54px"
            borderRadius="2xl"
            fontSize="15px"
            boxShadow="0 1px 4px rgb(16 16 32 / 0.06)"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || !canAskOnEnter) return;
              event.preventDefault();
              askLangy(typed);
            }}
          />
        </VStack>
        <Dialog.Body overflowY="auto" paddingY={5}>
          <VStack align="stretch" gap={6}>
            {sections.map((section) => (
              <QuestionSection key={section.id} section={section} onChoose={ask} />
            ))}
            {blocks.length > 0 && (
              <BlocksSection
                blocks={blocks}
                targetDashboardId={board.readOnly ? void 0 : board.id}
                onClose={onClose}
              />
            )}
            {!hasMatches && (
              <Text fontSize="13px" color="fg.muted">
                {langy.enabled
                  ? "No matching questions. Ask Langy below."
                  : "Nothing matches your search."}
              </Text>
            )}
          </VStack>
        </Dialog.Body>
        {langy.enabled && (
          <Dialog.Footer borderTopWidth="1px" paddingX={5} paddingY={3.5} position="relative">
            <Box
              aria-hidden
              position="absolute"
              insetX={0}
              top={0}
              height="3px"
              bgGradient="to-r"
              gradientFrom="purple.400"
              gradientVia="pink.400/60"
              gradientTo="transparent"
            />
            <HStack width="full" gap={3}>
              <Box
                display="flex"
                alignItems="center"
                justifyContent="center"
                boxSize={7}
                borderRadius="md"
                bgGradient="to-br"
                gradientFrom="purple.500"
                gradientTo="pink.500"
                color="white"
                flexShrink={0}
              >
                <Sparkles size={14} strokeWidth={2.1} aria-hidden />
              </Box>
              <Text
                flex={1}
                minWidth={0}
                truncate
                fontSize="12.5px"
                fontWeight="medium"
                color="purple.600"
              >
                Can't find what you're looking for?
              </Text>
              <Button
                variant="solid"
                flexShrink={0}
                bgGradient="to-r"
                gradientFrom="purple.600"
                gradientTo="pink.600"
                _hover={{ opacity: 0.9 }}
                onClick={() => askLangy(search)}
              >
                Ask Langy
              </Button>
            </HStack>
          </Dialog.Footer>
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}

function SectionHeading({ title, why, palette }: { title: string; why: string; palette: string }) {
  return (
    <VStack align="stretch" gap={0.5} paddingX={1}>
      <Text
        fontSize="10.5px"
        fontWeight="semibold"
        letterSpacing="0.09em"
        textTransform="uppercase"
        color={`${palette}.fg`}
      >
        {title}
      </Text>
      <Text fontSize="12px" lineHeight="relaxed" color="fg.subtle">
        {why}
      </Text>
    </VStack>
  );
}

function BlocksSection({
  blocks,
  targetDashboardId,
  onClose,
}: {
  blocks: readonly BlockDefinition[];
  /** Absent on the Flight Deck, where the member picks one of their own boards. */
  targetDashboardId: string | undefined;
  onClose: () => void;
}) {
  const host = useAnalyticsHost();
  const saved = useSavedDashboards();
  const boardBlocks = useBoardBlocks();
  const [chosenDestination, setChosenDestination] = useState<string | undefined>();
  const [isAdding, setIsAdding] = useState(false);
  const destination = chosenDestination ?? saved.boards[0]?.id ?? NEW_BOARD;

  const addToDestination = async (block: BlockDefinition) => {
    if (targetDashboardId) {
      const added = await boardBlocks.addBlock({
        dashboardId: targetDashboardId,
        blockId: block.id,
      });
      if (added) onClose();
      return;
    }
    const target =
      destination === NEW_BOARD
        ? await saved.createUntitledBoard()
        : saved.boards.find(({ id }) => id === destination);
    if (!target) return;
    const added = await boardBlocks.addBlock({ dashboardId: target.id, blockId: block.id });
    if (!added) return;
    host.succeeded({ title: `Added to ${target.name}` });
    host.navigate(dashboardsPath({ projectSlug: saved.projectSlug, dashboardId: target.id }));
  };

  const choose = (block: BlockDefinition) => {
    setIsAdding(true);
    void addToDestination(block).finally(() => setIsAdding(false));
  };

  return (
    <VStack as="section" aria-label="Blocks" align="stretch" gap={1.5}>
      <SectionHeading title="Blocks" why="Add a ready-made block to a board." palette="gray" />
      {!targetDashboardId && (
        <HStack gap={2} paddingX={1}>
          <Text fontSize="13px" color="fg.muted" flexShrink={0}>
            Add to
          </Text>
          <NativeSelect.Root size="sm">
            <NativeSelect.Field
              aria-label="Add to"
              value={destination}
              onChange={(event) => setChosenDestination(event.currentTarget.value)}
            >
              {saved.boards.map((each) => (
                <option key={each.id} value={each.id}>
                  {each.name}
                </option>
              ))}
              <option value={NEW_BOARD}>A new dashboard</option>
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </HStack>
      )}
      {blocks.map((block) => (
        <PickerRow
          key={block.id}
          title={block.title}
          detail={block.subtitle}
          icon={LayoutGrid}
          palette="gray"
          disabled={isAdding}
          onClick={() => choose(block)}
        />
      ))}
    </VStack>
  );
}

function QuestionSection({
  section,
  onChoose,
}: {
  section: BlockQuestionSection;
  onChoose: (question: BlockQuestion) => void;
}) {
  return (
    <VStack as="section" aria-label={section.title} align="stretch" gap={1.5}>
      <SectionHeading title={section.title} why={section.why} palette={section.palette} />
      {section.questions.map((question) => (
        <PickerRow
          key={question.id}
          title={question.question}
          detail={question.why}
          icon={QUESTION_ICONS[question.icon]}
          palette={section.palette}
          onClick={() => onChoose(question)}
        />
      ))}
    </VStack>
  );
}

function PickerRow({
  title,
  detail,
  icon: Icon,
  palette,
  disabled = false,
  onClick,
}: {
  title: string;
  detail: string;
  icon: LucideIcon;
  palette: string;
  disabled?: boolean;
  onClick: () => void;
}) {
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
          {title}
        </Text>
        <Text fontSize="12px" lineHeight="relaxed" color="fg.subtle" truncate>
          {detail}
        </Text>
      </VStack>
    </Button>
  );
}
