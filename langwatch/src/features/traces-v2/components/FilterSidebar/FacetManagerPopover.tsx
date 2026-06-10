import {
  Box,
  Button,
  HStack,
  Icon,
  IconButton,
  Input,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  Activity,
  AlertCircle,
  BadgeCheck,
  BarChart3,
  Bot,
  Compass,
  Cpu,
  Database,
  DollarSign,
  Filter,
  Hash,
  Layers,
  MessageSquare,
  MessageSquareText,
  Search,
  Settings2,
  Sparkles,
  Tag,
  Timer,
  User,
  Users,
  X,
  Zap,
} from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import { Checkbox } from "~/components/ui/checkbox";
import { Popover } from "~/components/ui/popover";
import { Tooltip } from "~/components/ui/tooltip";
import { FACET_GROUPS, getFacetGroupId } from "./constants";

/** Lucide icon per facet group, rendered next to the group label so
 *  the picker telegraphs each cluster's "type" at a glance. Falls back
 *  to the generic Filter glyph for groups added later without a
 *  hand-picked icon. Keys mirror the Round-3 AI-observability taxonomy
 *  in `constants.FACET_GROUPS`. */
const GROUP_ICON: Record<string, typeof Activity> = {
  origin: Compass,
  model: Sparkles,
  cost: DollarSign,
  errors: AlertCircle,
  quality: BadgeCheck,
  events: Activity,
  subjects: Users,
  topics: Tag,
  custom: Database,
};

/** Per-key icon mapping for the most common facets. Anything not
 *  listed falls back to {@link Filter}. Kept small on purpose: we only
 *  add an icon when it actually disambiguates one facet from another
 *  (a `model` row reading "Model" is fine; the `Cpu` icon next to it
 *  cuts ~50ms off the "which row am I scanning for?" decision). */
const KEY_ICON: Record<string, typeof Filter> = {
  status: AlertCircle,
  errorMessage: AlertCircle,
  origin: Sparkles,
  containsAi: Bot,
  rootSpanType: Layers,
  traceName: Tag,
  model: Cpu,
  service: Cpu,
  topic: Tag,
  subtopic: Tag,
  label: Tag,
  event: Activity,
  user: User,
  conversation: MessageSquare,
  customer: Users,
  scenarioRun: Activity,
  spanName: Tag,
  spanType: Layers,
  spanStatus: AlertCircle,
  annotation: MessageSquareText,
  evaluator: BadgeCheck,
  evaluatorStatus: AlertCircle,
  evaluatorVerdict: BadgeCheck,
  evaluatorScore: BarChart3,
  duration: Timer,
  cost: DollarSign,
  tokens: Hash,
  promptTokens: Hash,
  completionTokens: Hash,
  ttft: Zap,
  ttlt: Zap,
  tokensPerSecond: Zap,
  tokensEstimated: Hash,
  spans: Layers,
  selectedPrompt: MessageSquareText,
  lastUsedPrompt: MessageSquareText,
  promptVersion: Hash,
};

interface FacetManagerPopoverProps {
  /** Every facet key the backend has data for (visible + hidden). */
  orderedKeysAll: string[];
  /** Resolves key → human label; supplied by useFilterSidebarData. */
  sectionByKey: Map<string, { label: string }>;
  /** True when the section is currently rendered in the sidebar. */
  isVisible: (key: string) => boolean;
  /** Force-show a facet (writes `explicitlyShown`). */
  onShow: (key: string) => void;
  /** Force-hide a facet (writes `explicitlyHidden`). */
  onHide: (key: string) => void;
  /** Drop all overrides — sidebar returns to density default. */
  onResetAll: () => void;
  /**
   * Optional controlled-open prop. When set, the popover ignores its
   * internal `open` state and mirrors the caller's value (and reports
   * changes via `onOpenChange`). Used so the sidebar's text trigger and
   * any future external opener can drive the same popover instance.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * When set, the popover renders a labelled text Button as its
   * trigger instead of the default settings-icon IconButton. Drops the
   * tooltip in this mode — the label itself explains the action. Used
   * by the sidebar header where the new "Configure" CTA replaced the
   * old floating bottom-right button.
   */
  triggerLabel?: string;
}

/**
 * One-stop "edit which facets are in my sidebar" picker, opened from
 * the sidebar header.
 *
 * The inline affordances (hover-X on a section, per-group "+ Add facet")
 * cover ad-hoc edits but leave users without an overview of what's on
 * vs. off — audit feedback was "I can't tell what I'm missing." This
 * picker walks every key the backend returned and renders one Checkbox
 * per key, grouped by the FACET_GROUPS taxonomy so the structure
 * mirrors the sidebar itself.
 *
 * Layout uses a hard-clamped body height ({BODY_MAX_HEIGHT}px) instead
 * of a `vh`-relative `maxHeight` on Popover.Content — Chakra's popover
 * positioning logic measures the trigger and slots the floating panel
 * around it, but if the content has only a `maxHeight` constraint and
 * no internal scroll boundary, the popover renders at its natural
 * height (taller than the viewport) and Floating UI flips it to a
 * position where it overflows the top of the screen. Boxing the
 * scrollable area to a fixed pixel ceiling stops that.
 */
const BODY_MAX_HEIGHT_PX = 360;

export const FacetManagerPopover: React.FC<FacetManagerPopoverProps> = ({
  orderedKeysAll,
  sectionByKey,
  isVisible,
  onShow,
  onHide,
  onResetAll,
  open: controlledOpen,
  onOpenChange,
  triggerLabel,
}) => {
  // Controlled-or-uncontrolled hybrid: when the caller passes `open`
  // we treat it as the source of truth (so the floating Configure CTA
  // can drive the same popover the header icon drives). Without it,
  // the popover keeps its own local state — the original behaviour for
  // sidebar-only consumers.
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  const [query, setQuery] = useState("");

  const normalisedQuery = query.trim().toLowerCase();

  // Partition `orderedKeysAll` by group id, filtered by the search box
  // when present. Filtering matches against either the human label or
  // the raw key so power users can grep for `selectedPrompt` directly.
  const byGroup = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const key of orderedKeysAll) {
      if (normalisedQuery) {
        const label = sectionByKey.get(key)?.label ?? key;
        const matchesLabel = label.toLowerCase().includes(normalisedQuery);
        const matchesKey = key.toLowerCase().includes(normalisedQuery);
        if (!matchesLabel && !matchesKey) continue;
      }
      const groupId = getFacetGroupId(key) ?? "custom";
      (out[groupId] ??= []).push(key);
    }
    return out;
  }, [orderedKeysAll, normalisedQuery, sectionByKey]);

  const visibleCount = useMemo(
    () => orderedKeysAll.filter(isVisible).length,
    [orderedKeysAll, isVisible],
  );

  const totalMatching = useMemo(
    () => Object.values(byGroup).reduce((acc, ks) => acc + ks.length, 0),
    [byGroup],
  );

  const popover = (
    <Popover.Root
      open={open}
      onOpenChange={(e) => {
        setOpen(e.open);
        if (!e.open) setQuery("");
      }}
      positioning={{
        // `bottom-start` (popover's left edge anchored under the
        // trigger's left edge) so the panel extends INTO the trace
        // list rather than into the main app menu. The sidebar is
        // ~260px wide and the popover ~280px, so `bottom-end` rendered
        // the panel leftward — it covered the navigation chrome and
        // obscured part of the sidebar itself. Anchoring left-start
        // keeps the panel visually inside the trace-explorer surface.
        placement: "bottom-start",
        flip: true,
        overflowPadding: 8,
      }}
      lazyMount
      unmountOnExit
    >
      <Popover.Trigger asChild>
        {triggerLabel ? (
          <Button
            size="2xs"
            variant="ghost"
            color="fg.subtle"
            gap={1}
            paddingX={1.5}
            aria-label="Manage which facets appear in the sidebar"
            _hover={{ color: "fg", bg: "bg.muted" }}
          >
            <Settings2 size={12} />
            <Text textStyle="2xs" fontWeight="600">
              {triggerLabel}
            </Text>
          </Button>
        ) : (
          <IconButton
            size="2xs"
            variant="ghost"
            color="fg.subtle"
            aria-label="Manage which facets appear in the sidebar"
          >
            <Settings2 size={14} />
          </IconButton>
        )}
      </Popover.Trigger>
      <Popover.Content width="280px">
        <Popover.Body padding={0}>
          <VStack align="stretch" gap={0}>
            <HStack
              paddingX={3}
              paddingY={2}
              borderBottomWidth="1px"
              borderColor="border.subtle"
              justify="space-between"
            >
              <Text textStyle="xs" fontWeight="semibold" color="fg">
                Facets in sidebar
              </Text>
              <Text textStyle="2xs" color="fg.subtle">
                {visibleCount} of {orderedKeysAll.length}
              </Text>
            </HStack>
            <Box paddingX={2} paddingY={2}>
              <HStack
                gap={1.5}
                paddingX={2}
                borderWidth="1px"
                borderColor="border"
                borderRadius="sm"
                _focusWithin={{
                  borderColor: "blue.focusRing",
                  boxShadow: "0 0 0 1px var(--chakra-colors-blue-focusRing)",
                }}
              >
                <Search size={12} />
                <Input
                  size="xs"
                  variant="flushed"
                  placeholder="Filter facets…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  border="none"
                  // Drop the default Input focus ring — the wrapper
                  // HStack owns the focus treatment so the icon + input
                  // read as a single control.
                  _focus={{ boxShadow: "none" }}
                  height="22px"
                  paddingY={0}
                />
                {query && (
                  <IconButton
                    aria-label="Clear filter"
                    size="2xs"
                    variant="ghost"
                    color="fg.subtle"
                    onClick={() => setQuery("")}
                  >
                    <X size={10} />
                  </IconButton>
                )}
              </HStack>
            </Box>
            <Box
              maxHeight={`${BODY_MAX_HEIGHT_PX}px`}
              overflowY="auto"
              borderTopWidth="1px"
              borderColor="border.subtle"
            >
              {totalMatching === 0 ? (
                <Box paddingX={3} paddingY={4}>
                  <Text textStyle="xs" color="fg.subtle">
                    No facets match “{query}”.
                  </Text>
                </Box>
              ) : (
                FACET_GROUPS.map((group) => {
                  const keys = byGroup[group.id] ?? [];
                  if (keys.length === 0) return null;
                  const GroupIcon = GROUP_ICON[group.id] ?? Filter;
                  return (
                    <Box key={group.id}>
                      <HStack
                        gap={1.5}
                        paddingX={3}
                        paddingTop={2}
                        paddingBottom={1}
                      >
                        <Icon boxSize={3} color="fg.subtle">
                          <GroupIcon />
                        </Icon>
                        <Text
                          textStyle="2xs"
                          fontWeight="700"
                          color="fg.subtle"
                          textTransform="uppercase"
                          letterSpacing="0.1em"
                        >
                          {group.label}
                        </Text>
                      </HStack>
                      {keys.map((key) => {
                        const label = sectionByKey.get(key)?.label ?? key;
                        const checked = isVisible(key);
                        const KeyIcon = KEY_ICON[key] ?? Filter;
                        return (
                          <Box
                            key={key}
                            paddingX={3}
                            paddingY={1}
                            _hover={{ bg: "bg.muted" }}
                            cursor="pointer"
                            onClick={() =>
                              checked ? onHide(key) : onShow(key)
                            }
                          >
                            <Checkbox
                              size="sm"
                              checked={checked}
                              onCheckedChange={() =>
                                checked ? onHide(key) : onShow(key)
                              }
                              onClick={(e) => e.stopPropagation()}
                            >
                              <HStack gap={1.5}>
                                <Icon
                                  boxSize={3}
                                  color={checked ? "fg.muted" : "fg.subtle"}
                                >
                                  <KeyIcon />
                                </Icon>
                                <Text textStyle="xs" color="fg">
                                  {label}
                                </Text>
                              </HStack>
                            </Checkbox>
                          </Box>
                        );
                      })}
                    </Box>
                  );
                })
              )}
            </Box>
            <HStack
              paddingX={3}
              paddingY={2}
              borderTopWidth="1px"
              borderColor="border.subtle"
              justify="space-between"
            >
              <Button
                size="2xs"
                variant="ghost"
                color="fg.muted"
                onClick={() => onResetAll()}
              >
                Reset to defaults
              </Button>
              <Button size="2xs" variant="ghost" onClick={() => setOpen(false)}>
                Done
              </Button>
            </HStack>
          </VStack>
        </Popover.Body>
      </Popover.Content>
    </Popover.Root>
  );

  // When the caller asked for the labelled text button we drop the
  // tooltip — the label itself ("Configure") is the affordance, and
  // wrapping it in a hover-revealed tooltip felt redundant. The
  // icon-only path still gets the tooltip, since the Settings2 glyph
  // on its own benefits from spelling out the action.
  if (triggerLabel) return popover;
  return (
    // Tooltip wraps a Box that *contains* the Popover — not the
    // Popover.Trigger directly. Both `Tooltip` and `Popover.Trigger`
    // use `asChild` ref forwarding under the hood, and when they
    // stack on the same node they fight over the slot, leaving the
    // popover with no measurable anchor (it lands at the viewport's
    // top-left). Splitting the chains via a host Box gives each
    // component its own ref target — Tooltip anchors to the Box,
    // Popover anchors to the IconButton. Same pattern as
    // CreateLensButton.
    <Tooltip
      positioning={{ placement: "bottom" }}
      content="Choose which facets appear in the sidebar"
      openDelay={300}
    >
      <Box display="inline-flex">{popover}</Box>
    </Tooltip>
  );
};
