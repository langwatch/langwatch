/**
 * The "Add a block" picker. A question closes it and asks Langy with the board
 * attached, writing nothing; a pinned footer always offers to ask Langy anything else.
 * With Langy unavailable to the member, no question can be sent, so the picker is empty.
 */

import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
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
  Sparkles,
  TrendingDown,
  XCircle,
} from "lucide-react";
import { useRef, useState } from "react";

import type { BlockPeriod } from "../../blocks/index.ts";
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
} from "../../model/block-questions.ts";

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

export function BlockPickerDialog({
  board,
  period,
  onClose,
}: {
  /** The board the picker opened on, attached as Langy's context. */
  board: BoardSubject;
  period: BlockPeriod;
  onClose: () => void;
}) {
  const langy = useLangyAsk();
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const sections = langy.enabled
    ? searchBlockQuestions({ sections: BLOCK_QUESTION_SECTIONS, search })
    : [];
  const typed = search.trim();
  const hasMatches = sections.length > 0;
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
    <Dialog.Root
      open
      size="lg"
      initialFocusEl={() => searchRef.current}
      onOpenChange={({ open }) => !open && onClose()}
    >
      <Dialog.Content maxHeight="76vh" maxWidth="720px" borderRadius="xl">
        <Dialog.Header borderBottomWidth="1px" paddingX={5} paddingY={3.5}>
          <Dialog.Title fontSize="14px" fontWeight="semibold">
            Add a block
          </Dialog.Title>
          <Dialog.CloseTrigger />
        </Dialog.Header>
        <VStack align="stretch" gap={3} paddingX={5} paddingY={5} borderBottomWidth="1px">
          <SearchInput
            ref={searchRef}
            aria-label="Search questions"
            placeholder={langy.enabled ? "What do you need to know?" : "Search questions"}
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
                color="white"
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
        <Text fontSize="13px" lineHeight="1.375" fontWeight="medium" color="fg" truncate>
          {title}
        </Text>
        <Text fontSize="12px" lineHeight="1.625" color="fg.subtle" truncate>
          {detail}
        </Text>
      </VStack>
    </Button>
  );
}
