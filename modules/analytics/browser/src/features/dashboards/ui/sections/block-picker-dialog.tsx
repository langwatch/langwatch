/**
 * "Add a widget", laid out like the templates finder: one centred search, category chips and
 * agent-type chips over the built widgets in question-tree branch sections. A pick adds the
 * widget and drafts its prompt in Langy (AC141); Skip goes to the widget editor instead.
 */

import { Dialog } from "@langwatch/design-system/dialog";
import { Box, Button, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import {
  Activity,
  AlertTriangle,
  Bot,
  Gauge,
  GitCompare,
  HelpCircle,
  type LucideIcon,
  Scale,
  Sparkles,
  TrendingDown,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  AGENT_KIND_CHIP_LABELS,
  pickerPool,
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
import type { BoardPeriod } from "../../model/board-period.ts";
import {
  type CatalogueFilters,
  filterCatalogue,
  NO_CATALOGUE_FILTERS,
  trunkCounts,
} from "../../model/catalogue-filter.ts";
import type { WidgetQuestion, WidgetQuestionIcon } from "../../model/widget-questions.ts";
import {
  AgentKindChips,
  CatalogueSearch,
  TRUNK_ICONS,
  TRUNK_PALETTES,
  TrunkChips,
} from "../blocks/catalogue-filters.tsx";

const QUESTION_ICONS: Readonly<Record<WidgetQuestionIcon, LucideIcon>> = {
  activity: Activity,
  trendingDown: TrendingDown,
  alertTriangle: AlertTriangle,
  gitCompare: GitCompare,
  helpCircle: HelpCircle,
  gauge: Gauge,
  scale: Scale,
};

export function BlockPickerDialog({
  board,
  period,
  initialSearch = "",
  onAddWidgets,
  onSkip,
  onClose,
}: {
  /** The board the picker opened on, attached as Langy's context. */
  board: BoardSubject;
  period: BoardPeriod;
  /** The search it opens with, such as what the ask bar had typed. */
  initialSearch?: string;
  /** Adds the picked question's widget(s) to the board; false when the write failed. */
  onAddWidgets: (question: WidgetQuestion) => Promise<boolean>;
  /** Opens the widget editor on a new widget instead; the caller closes the picker with it. */
  onSkip: () => void;
  onClose: () => void;
}) {
  const langy = useLangyAsk();
  const [filters, setFilters] = useState<CatalogueFilters>({
    ...NO_CATALOGUE_FILTERS,
    search: initialSearch,
  });
  const searchRef = useRef<HTMLInputElement>(null);
  // The dialog's focus selects the search; the caret goes to the end instead, so typing
  // carries on from the ask bar rather than replacing what was typed there.
  useEffect(() => {
    if (!initialSearch) return;
    const frame = requestAnimationFrame(() => {
      searchRef.current?.setSelectionRange(initialSearch.length, initialSearch.length);
    });
    return () => cancelAnimationFrame(frame);
  }, [initialSearch]);

  // The agent type picks the pool; the search and the category narrow it.
  const pool = pickerPool({ agentKind: filters.agentKind });
  const sections = pickerSections({ questions: filterCatalogue({ items: pool, filters }) });
  const typed = filters.search.trim();
  const hasMatches = sections.length > 0;

  const addWidget = async (question: WidgetQuestion) => {
    // A failed write is reported by the host; leave the picker open and seed nothing.
    if (!(await onAddWidgets(question))) return;
    if (langy.enabled) {
      for (const widget of pickerWidgets(question.id)) {
        langy.ask(widgetPromptDraft({ widget, board, period }));
      }
    }
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
      <Dialog.Content maxHeight="76vh" maxWidth="800px" borderRadius="xl">
        <Dialog.Header borderBottomWidth="1px" paddingX={5} paddingY={3.5}>
          <HStack width="full" gap={2}>
            <Dialog.Title fontSize="14px" fontWeight="semibold">
              Add a widget
            </Dialog.Title>
            <Button
              size="sm"
              variant="outline"
              marginStart="auto"
              title="Write the widget yourself, with Langy"
              onClick={onSkip}
            >
              Skip
            </Button>
            <Dialog.CloseTrigger position="static" />
          </HStack>
        </Dialog.Header>
        <VStack gap={3} paddingX={5} paddingY={4} borderBottomWidth="1px">
          <CatalogueSearch
            inputRef={searchRef}
            placeholder="Search widgets"
            value={filters.search}
            onChange={(search) => setFilters({ ...filters, search })}
            onEnter={
              langy.enabled && !hasMatches && typed.length > 0 ? () => askLangy(typed) : void 0
            }
          />
          <TrunkChips
            picked={filters.trunk}
            counts={trunkCounts({ items: pool, search: filters.search })}
            onPick={(trunk) => setFilters({ ...filters, trunk })}
          />
          <AgentKindChips
            picked={filters.agentKind}
            countOf={(agentKind) =>
              filterCatalogue({ items: pickerPool({ agentKind }), filters }).length
            }
            onPick={(agentKind) => setFilters({ ...filters, agentKind })}
          />
        </VStack>
        <Dialog.Body overflowY="auto" paddingX={3} paddingY={4}>
          <VStack align="stretch" gap={5}>
            {sections.map((section) => (
              <WidgetSection
                key={section.id}
                section={section}
                onChoose={(question) => void addWidget(question)}
              />
            ))}
            {!hasMatches && (
              <VStack align="start" gap={2} paddingX={3}>
                <Text fontSize="13px" color="fg.muted">
                  No widget matches. Skip to write your own with Langy.
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

/** A branch's heading: its trunk's icon as the one touch of colour, its name and what it covers. */
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

function WidgetSection({
  section,
  onChoose,
}: {
  section: PickerSection;
  onChoose: (question: PickerQuestion) => void;
}) {
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
          palette={TRUNK_PALETTES[section.trunk]}
          onChoose={() => onChoose(question)}
        />
      ))}
    </VStack>
  );
}

/** A row: the question that adds the widget, what it shows, and the agent types it is made for. */
function PickerRow({
  question,
  palette,
  onChoose,
}: {
  question: PickerQuestion;
  /** The trunk's design-system palette, tinting the icon. */
  palette: string;
  onChoose: () => void;
}) {
  const Icon = QUESTION_ICONS[question.icon];
  return (
    <Button
      variant="plain"
      height="auto"
      width="full"
      justifyContent="flex-start"
      gap={3}
      paddingX={3}
      paddingY={2.5}
      borderRadius="lg"
      fontWeight="normal"
      data-widget={question.id}
      _hover={{ background: "bg.muted" }}
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
      {question.madeFor.length > 0 && (
        <HStack flexShrink={0} gap={1} fontSize="12px" color="fg.muted">
          <Bot size={12} aria-hidden />
          {question.madeFor.map((kind) => AGENT_KIND_CHIP_LABELS[kind]).join(", ")}
        </HStack>
      )}
    </Button>
  );
}
