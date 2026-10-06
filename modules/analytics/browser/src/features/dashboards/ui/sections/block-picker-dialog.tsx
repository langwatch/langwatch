/**
 * The "Add a block" picker: every catalogue widget, filtered as the library is (only while
 * open), in branch sections by trunk. Choosing one adds it and drafts its widget's prompt in
 * Langy, as Ask Langy on its card does (AC141). A pinned footer asks Langy anything else.
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
  PICKER_QUESTIONS,
  type PickerQuestion,
  type PickerSection,
  pickerSections,
  pickerWidgets,
} from "../../catalogue/index.ts";
import { useLangyAsk } from "../../langy/behavior/use-board-langy.ts";
import {
  type BoardSubject,
  boardQuestion,
  widgetPromptDraft,
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
  AgentKindLabels,
  CatalogueFilterBar,
  CatalogueFilterLabel,
  TRUNK_ICONS,
  TRUNK_PALETTES,
} from "../blocks/catalogue-filters.tsx";

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
      for (const widget of pickerWidgets(question.id)) {
        langy.ask(widgetPromptDraft({ widget, board, period }));
      }
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
            height="44px"
            borderRadius="xl"
            fontSize="14px"
            value={filters.search}
            onChange={(event) => setFilters({ ...filters, search: event.target.value })}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || !canAskOnEnter) return;
              event.preventDefault();
              askLangy(typed);
            }}
          />
          <CatalogueFilterBar compact filters={filters} counts={counts} onChange={setFilters} />
        </VStack>
        <Dialog.Body overflowY="auto" paddingX={3} paddingY={4}>
          <VStack align="stretch" gap={5}>
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
              <VStack align="start" gap={2} paddingX={2}>
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
          <Dialog.Footer borderTopWidth="1px" paddingX={5} paddingY={3} background="bg.subtle">
            <HStack width="full" gap={3}>
              <Text flex={1} minWidth={0} truncate fontSize="13px" color="fg.muted">
                Can't find what you're looking for?
              </Text>
              <Button
                size="sm"
                variant="outline"
                flexShrink={0}
                onClick={() => askLangy(filters.search)}
              >
                <Box as="span" display="inline-flex" colorPalette="purple" color="colorPalette.fg">
                  <Sparkles size={14} aria-hidden />
                </Box>
                Ask Langy
              </Button>
            </HStack>
          </Dialog.Footer>
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}

/** A branch's heading: its trunk's icon as the one touch of colour, its name and why it matters. */
function SectionHeading({ section }: { section: PickerSection }) {
  const Icon = TRUNK_ICONS[section.trunk];
  return (
    <HStack gap={2} minWidth={0} paddingX={3} paddingBottom={1}>
      <Box
        as="span"
        display="inline-flex"
        flexShrink={0}
        colorPalette={TRUNK_PALETTES[section.trunk]}
        color="colorPalette.fg"
      >
        <Icon size={13} strokeWidth={2.2} aria-hidden />
      </Box>
      <Text as="h3" flexShrink={0} fontSize="12.5px" fontWeight="semibold" color="fg">
        {section.title}
      </Text>
      <Text minWidth={0} truncate fontSize="12px" color="fg.subtle">
        {section.why}
      </Text>
    </HStack>
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
      gap={0.5}
    >
      <SectionHeading section={section} />
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
  const trunkPick: CatalogueFilterPick = { group: "trunks", value: question.trunk };
  return (
    <VStack
      align="stretch"
      gap={1.5}
      paddingX={3}
      paddingY={2.5}
      borderRadius="lg"
      _hover={comingSoon ? void 0 : { background: "bg.muted" }}
    >
      <Button
        variant="plain"
        height="auto"
        padding={0}
        justifyContent="flex-start"
        gap={3}
        fontWeight="normal"
        disabled={comingSoon}
        onClick={onChoose}
      >
        <Box
          display="flex"
          alignItems="center"
          justifyContent="center"
          boxSize={7}
          borderRadius="md"
          colorPalette={palette}
          background="colorPalette.subtle"
          color="colorPalette.fg"
          flexShrink={0}
        >
          <Icon size={14} strokeWidth={2.1} aria-hidden />
        </Box>
        <VStack align="stretch" gap={0} minWidth={0} flex={1} textAlign="start">
          <Text fontSize="13px" lineHeight="20px" fontWeight="medium" color="fg" truncate>
            {question.question}
          </Text>
          <Text fontSize="12px" lineHeight="18px" color="fg.muted" truncate>
            {question.why}
          </Text>
        </VStack>
        {comingSoon && (
          <Text flexShrink={0} fontSize="12px" color="fg.subtle">
            Coming soon
          </Text>
        )}
      </Button>
      {/* Lined up under the question text: the icon's width and the gap. */}
      <HStack gap={1} wrap="wrap" paddingStart={10}>
        <CatalogueFilterLabel
          label={question.trunk}
          colorPalette={palette}
          isActive={isPicked({ filters, pick: trunkPick })}
          onToggle={() => onFilter(trunkPick)}
        />
        <AgentKindLabels agentKinds={question.agentKinds} filters={filters} onFilter={onFilter} />
      </HStack>
    </VStack>
  );
}
