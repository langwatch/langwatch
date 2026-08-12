import {
  Badge,
  Box,
  Collapsible,
  HStack,
  SimpleGrid,
  Stack,
  Text,
} from "@chakra-ui/react";
import type { SlackDeliveryMethod } from "@langwatch/automations/providers/slack";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  type DraftCadence,
  pickDefaultSlackBlockKitTemplateId,
  type ReportTemplateSource,
  type SlackBlockKitTemplateKind,
  type SlackBlockKitTemplateOption,
  templateOptionsFor,
} from "./registry";

/** Note shown on a template a webhook connection can't render in full. */
const GATED_NOTE = "Needs a Slack app connection";

interface Props {
  cadence: DraftCadence;
  /** Trace automations and graph alerts render against different variable
   *  sets, so the picker only offers layouts built for the draft's kind. */
  kind: SlackBlockKitTemplateKind;
  /** For a report: what it sends. Only layouts that can render that source's
   *  data are offered — a chart layout has nothing to plot for a trace-query
   *  report. A dashboard needs no layout at all, so the form owner does not
   *  render the picker for it. */
  reportSource?: ReportTemplateSource;
  /** The chosen delivery method. Templates that lead with a modern block
   *  (`gatedBlock`) render in full only on a bot connection, so on a webhook
   *  they show but can't be picked. */
  deliveryMethod: SlackDeliveryMethod;
  hasEvaluationFilter: boolean;
  /** The current value of slice.template — used to highlight which preset
   *  (if any) matches it. Custom edits highlight nothing. */
  currentSource: string;
  onSelect: (option: SlackBlockKitTemplateOption) => void;
  /** Picking a layout built for the other cadence. The form owner switches
   *  the cadence alongside the template so the author doesn't have to make
   *  the round-trip to the cadence stage. */
  onSelectOtherCadence: (option: SlackBlockKitTemplateOption) => void;
}

function introFor({
  kind,
  cadence,
  reportSource,
}: Pick<Props, "kind" | "cadence" | "reportSource">): string {
  if (kind === "report") {
    return reportSource === "customGraph"
      ? "Your report sends a graph, so every layout plots it. The thumbnail shows structure, not the final look."
      : "Your report sends the traces that match, so every layout lists them. The thumbnail shows structure, not the final look.";
  }
  if (kind === "graphAlert") {
    return "Each layout sends one message when the alert fires. The thumbnail shows structure, not the final look.";
  }
  return cadence === "digest"
    ? "Your cadence bundles every trace matched in the window into one digest message. Pick a starting layout — the thumbnail shows structure, not the final look."
    : "Each matching trace sends its own message. Pick a starting layout — the thumbnail shows structure, not the final look.";
}

export function SlackBlockKitTemplatePicker({
  cadence,
  kind,
  reportSource,
  deliveryMethod,
  hasEvaluationFilter,
  currentSource,
  onSelect,
  onSelectOtherCadence,
}: Props) {
  // The grouping (which layouts sit in the primary grid vs. behind the
  // "N more layouts" disclosure) is latched to the cadence the picker last
  // settled on. Picking a cross-cadence layout changes the draft's cadence —
  // see `onSelectOtherCadence` below — and that change flows back down as a
  // new `cadence` prop. Deriving the grouping from the live prop on every
  // render would swap the two groups on every cross-cadence pick: the
  // disclosure the author just expanded becomes the primary grid and jumps
  // to the top, and the layout they were looking at moves out from under
  // them. Selecting still updates the highlight and the draft's cadence —
  // it just never reshuffles the list AS A RESULT OF THAT PICK.
  //
  // The composer's facets are independently open (not a single-open
  // accordion — see FacetSection), so the author can also change cadence
  // from the separate Cadence section while this picker stays mounted. That
  // external change must still regroup the gallery — `groupingCadence`
  // exists to survive an in-picker pick, not to pin the picker to whatever
  // cadence happened to be active when it first mounted. `selfInitiatedRef`
  // marks the cadence value `onSelectOtherCadence` itself is about to cause,
  // so the effect below can tell "I changed it" apart from "it changed
  // elsewhere" and only resync for the latter.
  const [groupingCadence, setGroupingCadence] = useState<DraftCadence>(cadence);
  const selfInitiatedRef = useRef<DraftCadence | null>(null);
  useEffect(() => {
    if (cadence === groupingCadence) return;
    if (selfInitiatedRef.current === cadence) {
      selfInitiatedRef.current = null;
      return;
    }
    setGroupingCadence(cadence);
  }, [cadence, groupingCadence]);
  const options = templateOptionsFor({
    cadence: groupingCadence,
    kind,
    reportSource,
  });
  const otherCadence: DraftCadence =
    groupingCadence === "digest" ? "immediate" : "digest";
  const otherOptions = templateOptionsFor({
    cadence: otherCadence,
    kind,
    reportSource,
  }).filter((opt) => opt.cadenceFit !== "both");
  const [otherOpen, setOtherOpen] = useState(false);
  const handleSelectOtherCadence = (option: SlackBlockKitTemplateOption) => {
    selfInitiatedRef.current = otherCadence;
    onSelectOtherCadence(option);
  };
  const defaultId = pickDefaultSlackBlockKitTemplateId({
    cadence,
    hasEvaluationFilter,
    kind,
    reportSource,
  });

  return (
    <Stack gap={2} align="stretch">
      <Text textStyle="xs" color="fg.muted">
        {introFor({ kind, cadence, reportSource })}
      </Text>
      <SimpleGrid
        columns={{ base: 2, md: Math.min(options.length, 3) }}
        gap={3}
        alignItems="stretch"
      >
        {options.map((option) => {
          const isSelected = option.source === currentSource;
          const isDefault = option.id === defaultId;
          const locked = deliveryMethod === "webhook" && !!option.gatedBlock;
          return (
            <Card
              key={option.id}
              option={option}
              isSelected={isSelected}
              isDefault={isDefault}
              locked={locked}
              lockedNote={GATED_NOTE}
              onClick={() => onSelect(option)}
            />
          );
        })}
      </SimpleGrid>
      {/* Alerts have no cadence choice (they always fire immediately), so
          the cross-cadence layouts section only applies to trace drafts. */}
      {kind !== "graphAlert" && otherOptions.length > 0 ? (
        <Collapsible.Root
          open={otherOpen}
          onOpenChange={(d) => setOtherOpen(d.open)}
        >
          <Collapsible.Trigger asChild>
            <HStack
              cursor="pointer"
              gap={1}
              color="fg.muted"
              width="fit-content"
            >
              {otherOpen ? (
                <ChevronDown size={14} />
              ) : (
                <ChevronRight size={14} />
              )}
              <Text textStyle="xs">
                {otherCadence === "digest"
                  ? `${otherOptions.length} more layouts for digest cadences`
                  : `${otherOptions.length} more layouts for the Immediate cadence`}
              </Text>
            </HStack>
          </Collapsible.Trigger>
          <Collapsible.Content>
            <Stack gap={2} align="stretch" pt={2}>
              <Text textStyle="xs" color="fg.muted">
                {otherCadence === "digest"
                  ? "These layouts bundle every match in a window into one message. Picking one switches this automation's cadence to a 5-minute digest — you can adjust the window in the Cadence section."
                  : "These layouts send one message per matching trace. Picking one switches this automation's cadence to Immediate."}
              </Text>
              <SimpleGrid
                columns={{ base: 2, md: Math.min(otherOptions.length, 3) }}
                gap={3}
                alignItems="stretch"
              >
                {otherOptions.map((option) => (
                  <Card
                    key={option.id}
                    option={option}
                    isSelected={option.source === currentSource}
                    isDefault={false}
                    locked={deliveryMethod === "webhook" && !!option.gatedBlock}
                    lockedNote={GATED_NOTE}
                    onClick={() => handleSelectOtherCadence(option)}
                  />
                ))}
              </SimpleGrid>
            </Stack>
          </Collapsible.Content>
        </Collapsible.Root>
      ) : null}
    </Stack>
  );
}

function Card({
  option,
  isSelected,
  isDefault,
  locked,
  lockedNote,
  onClick,
}: {
  option: SlackBlockKitTemplateOption;
  isSelected: boolean;
  isDefault: boolean;
  /** Rendered but not selectable — the current connection can't render this
   *  layout in full. The wireframe still shows so the author can see what it
   *  would look like once they connect a Slack app. */
  locked?: boolean;
  lockedNote?: string;
  onClick: () => void;
}) {
  const { Wireframe } = option;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={locked}
      aria-pressed={isSelected}
      aria-label={`Use ${option.displayName} template`}
      style={{
        textAlign: "left",
        width: "100%",
        height: "100%",
        cursor: locked ? "not-allowed" : undefined,
      }}
    >
      <Box
        height="full"
        borderWidth={isSelected ? "2px" : "1px"}
        borderColor={isSelected ? "border.emphasized" : "border"}
        borderRadius="md"
        bg="bg.panel/60"
        padding={3}
        opacity={locked ? 0.6 : 1}
        transition="border-color 120ms ease"
        _hover={locked ? undefined : { borderColor: "border.emphasized" }}
      >
        <Stack gap={2} align="stretch" height="full">
          <HStack gap={2}>
            <Text textStyle="md">{option.emoji}</Text>
            <Text textStyle="sm" fontWeight="medium">
              {option.displayName}
            </Text>
            {isDefault ? (
              <Badge size="sm" colorPalette="orange" variant="subtle">
                Default
              </Badge>
            ) : null}
          </HStack>
          <Box
            borderWidth="1px"
            borderColor="border.muted"
            borderRadius="sm"
            padding={2}
            bg="bg.subtle"
            height="120px"
            overflow="hidden"
            flexShrink={0}
          >
            <Wireframe />
          </Box>
          {locked && lockedNote ? (
            <Badge
              size="xs"
              variant="subtle"
              colorPalette="gray"
              alignSelf="start"
            >
              {lockedNote}
            </Badge>
          ) : (
            <Badge size="xs" variant="surface" alignSelf="start">
              {option.deliveryNote}
            </Badge>
          )}
          <Text textStyle="xs" color="fg.muted" lineClamp={2}>
            {option.tagline}
          </Text>
        </Stack>
      </Box>
    </button>
  );
}
