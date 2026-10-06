/**
 * The "Add a block" picker: every catalogue widget, narrowed by the templates library's search
 * and chips (kept only while open), in branch sections coloured by trunk. Choosing one adds it,
 * then drafts its prompt in Langy when available. A pinned footer asks Langy anything else.
 */

import { Dialog } from "@langwatch/design-system/dialog";
import { Box, Button, HStack, Text, VStack } from "@langwatch/design-system/primitives";
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

import {
  AGENT_KIND_LABELS,
  PICKER_QUESTIONS,
  type PickerQuestion,
  type PickerSection,
  pickerSections,
} from "../../catalogue/index.ts";
import { useLangyAsk } from "../../langy/behavior/use-board-langy.ts";
import {
  type BoardSubject,
  boardPromptDraft,
  boardQuestion,
} from "../../langy/model/board-langy.ts";
import type { BlockQuestion, BlockQuestionIcon } from "../../model/block-questions.ts";
import type { BoardPeriod } from "../../model/board-period.ts";
import {
  type CatalogueFilterPick,
  type CatalogueFilters,
  catalogueChipCounts,
  filterCatalogue,
  isPicked,
  NO_CATALOGUE_FILTERS,
  toggleCatalogueFilter,
} from "../../model/catalogue-filter.ts";
import {
  CatalogueFilterChips,
  CatalogueFilterLabel,
  TRUNK_PALETTES,
} from "../blocks/catalogue-filter-chips.tsx";

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
  onAddWidgets,
  onClose,
}: {
  /** The board the picker opened on, attached as Langy's context. */
  board: BoardSubject;
  period: BoardPeriod;
  /** Adds the picked question's widget(s) to the board; false when the write failed. */
  onAddWidgets: (question: BlockQuestion) => Promise<boolean>;
  onClose: () => void;
}) {
  const langy = useLangyAsk();
  const [filters, setFilters] = useState<CatalogueFilters>(NO_CATALOGUE_FILTERS);
  const searchRef = useRef<HTMLInputElement>(null);

  const shown = filterCatalogue({ items: PICKER_QUESTIONS, filters });
  const counts = catalogueChipCounts({ items: PICKER_QUESTIONS, filters });
  const sections = pickerSections({ questions: shown });
  const typed = filters.search.trim();
  const hasMatches = sections.length > 0;
  const canAskOnEnter = langy.enabled && !hasMatches && typed.length > 0;

  const addBlock = async (question: BlockQuestion) => {
    // A failed write is reported by the host; leave the picker open and seed nothing.
    if (!(await onAddWidgets(question))) return;
    if (langy.enabled) {
      langy.ask(boardPromptDraft({ prompt: question.prompt, board, period }));
    }
    onClose();
  };

  const choose = (question: PickerQuestion) => void addBlock(question);

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
        <VStack align="stretch" gap={3} paddingX={5} paddingY={4} borderBottomWidth="1px">
          <SearchInput
            ref={searchRef}
            aria-label="Search questions"
            placeholder={langy.enabled ? "What do you need to know?" : "Search questions"}
            height="54px"
            borderRadius="2xl"
            fontSize="15px"
            boxShadow="xs"
            value={filters.search}
            onChange={(event) => setFilters({ ...filters, search: event.target.value })}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || !canAskOnEnter) return;
              event.preventDefault();
              askLangy(typed);
            }}
          />
          <CatalogueFilterChips compact filters={filters} counts={counts} onChange={setFilters} />
        </VStack>
        <Dialog.Body overflowY="auto" paddingY={5}>
          <VStack align="stretch" gap={6}>
            {sections.map((section) => (
              <QuestionSection
                key={section.id}
                section={section}
                filters={filters}
                onFilter={(pick) => setFilters(toggleCatalogueFilter({ filters, pick }))}
                onChoose={choose}
              />
            ))}
            {!hasMatches && (
              <VStack align="start" gap={2}>
                <Text fontSize="13px" color="fg.muted">
                  {langy.enabled
                    ? "No matching questions. Ask Langy below."
                    : "No matching questions."}
                </Text>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => setFilters(NO_CATALOGUE_FILTERS)}
                >
                  Clear search and filters
                </Button>
              </VStack>
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
                onClick={() => askLangy(filters.search)}
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
        colorPalette={palette}
        color="colorPalette.fg"
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
  filters,
  onFilter,
  onChoose,
}: {
  section: PickerSection;
  filters: CatalogueFilters;
  onFilter: (pick: CatalogueFilterPick) => void;
  onChoose: (question: PickerQuestion) => void;
}) {
  const palette = TRUNK_PALETTES[section.trunk];
  return (
    <VStack
      as="section"
      aria-label={section.title}
      data-trunk={section.trunk}
      align="stretch"
      gap={1.5}
    >
      <SectionHeading title={section.title} why={section.why} palette={palette} />
      {section.questions.map((question) => (
        <PickerRow
          key={question.id}
          question={question}
          palette={palette}
          filters={filters}
          onFilter={onFilter}
          onChoose={() => onChoose(question)}
        />
      ))}
    </VStack>
  );
}

/** A row: the button that adds the widget, then its trunk and agent kind labels that filter. */
function PickerRow({
  question,
  palette,
  filters,
  onFilter,
  onChoose,
}: {
  question: PickerQuestion;
  /** The trunk's design-system palette, tinting the icon and the trunk label. */
  palette: string;
  filters: CatalogueFilters;
  onFilter: (pick: CatalogueFilterPick) => void;
  onChoose: () => void;
}) {
  const Icon = QUESTION_ICONS[question.icon];
  const comingSoon = question.status === "coming-soon";
  const label = (pick: CatalogueFilterPick) => ({
    isActive: isPicked({ filters, pick }),
    onToggle: () => onFilter(pick),
  });
  return (
    <VStack
      align="stretch"
      gap={0}
      borderWidth="1px"
      borderRadius="xl"
      borderColor="border"
      background="bg.panel"
      boxShadow="xs"
      _hover={{ borderColor: "teal.solid/50", boxShadow: "sm" }}
    >
      <Button
        variant="plain"
        height="auto"
        justifyContent="flex-start"
        gap={3}
        paddingX={4}
        paddingTop={3}
        paddingBottom={1.5}
        fontWeight="normal"
        disabled={comingSoon}
        onClick={onChoose}
      >
        <Box
          display="flex"
          alignItems="center"
          justifyContent="center"
          boxSize={8}
          borderRadius="md"
          colorPalette={palette}
          background="colorPalette.subtle"
          color="colorPalette.fg"
          flexShrink={0}
        >
          <Icon size={16} strokeWidth={2.1} aria-hidden />
        </Box>
        <VStack align="stretch" gap={0} minWidth={0} flex={1} textAlign="start">
          <Text fontSize="13px" lineHeight="1.375" fontWeight="medium" color="fg" truncate>
            {question.question}
          </Text>
          <Text fontSize="12px" lineHeight="1.625" color="fg.subtle" truncate>
            {question.why}
          </Text>
        </VStack>
        {comingSoon && (
          <Text
            flexShrink={0}
            fontSize="11px"
            fontWeight="medium"
            color="fg.muted"
            background="bg.muted"
            borderRadius="full"
            paddingX={2}
            paddingY={0.5}
          >
            Coming soon
          </Text>
        )}
      </Button>
      {/* Lined up under the question text: the row's padding, the icon and the gap. */}
      <HStack gap={1} wrap="wrap" paddingStart={15} paddingEnd={4} paddingBottom={3}>
        <CatalogueFilterLabel
          label={question.trunk}
          colorPalette={palette}
          {...label({ group: "trunks", value: question.trunk })}
        />
        {question.agentKinds.length === 0 ? (
          <CatalogueFilterLabel label="Any agent" />
        ) : (
          question.agentKinds.map((kind) => (
            <CatalogueFilterLabel
              key={kind}
              label={AGENT_KIND_LABELS[kind]}
              {...label({ group: "agentKinds", value: kind })}
            />
          ))
        )}
      </HStack>
    </VStack>
  );
}
