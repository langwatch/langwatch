import { HStack } from "@chakra-ui/react";
import { AlertType } from "@prisma/client";
import { Calendar, TrendingUp, Zap } from "lucide-react";
import type { ConditionSource } from "../logic/draftReducer";
import { useAutomationStore } from "../state/automationStore";
import { useDraft } from "../state/selectors";
import { FacetSection, type FacetAccordionProps } from "./FacetSection";
import { SourceCard } from "./SourceCard";

/** The three presets, in ADR-043 order, each with its list-page accent. */
const TYPES: {
  source: ConditionSource;
  title: string;
  description: string;
  accent: string;
  icon: React.ReactNode;
  /** Copy shown on the other cards when this preset is locked in. */
  lockedTooltip: string;
}[] = [
  {
    source: "trace",
    title: "Automation",
    description: "Act on each matching trace as it arrives.",
    accent: "blue",
    icon: <Zap size={16} />,
    lockedTooltip:
      "This automation acts on trace data. Create a new one to watch a metric or send a report.",
  },
  {
    source: "customGraph",
    title: "Alert",
    description: "Watch a metric and fire when it crosses a threshold.",
    accent: "orange",
    icon: <TrendingUp size={16} />,
    lockedTooltip:
      "This alert watches a graph metric. Create a new automation to act on trace data.",
  },
  {
    source: "report",
    title: "Schedule",
    description: "Send a dashboard, graph, or trace table.",
    accent: "purple",
    icon: <Calendar size={16} />,
    lockedTooltip: "Create a new automation to send something on a schedule.",
  },
];

/**
 * The Type facet (ADR-043 facet 2) — the preset the author picks FIRST,
 * which fixes every later facet. Always dispatches `SET_SOURCE` (never
 * mutates `source` directly) so the reducer clears the cross-source fields
 * and resets any action the new preset can't run. Switching to an alert
 * seeds the Warning severity when none is set, matching the page entry
 * points, so a fresh alert can save without a detour.
 */
export function AutomationTypePicker({
  sourceLocked = false,
  accordion,
}: {
  /** The preset can't change (editing a saved alert, or opened from a
   *  specific chart). The unpicked cards render visibly inert. */
  sourceLocked?: boolean;
  accordion?: FacetAccordionProps;
}) {
  const draft = useDraft();
  const dispatch = useAutomationStore((s) => s.dispatch);

  const pick = (source: ConditionSource) => {
    if (source === draft.source) return;
    dispatch({ type: "SET_SOURCE", value: source });
    if (source === "customGraph" && draft.alertType === null) {
      dispatch({ type: "SET_ALERT_TYPE", value: AlertType.WARNING });
    }
  };

  const activeTitle = TYPES.find((t) => t.source === draft.source)?.title ?? "";

  return (
    <FacetSection
      title="Type"
      help="Automations act on each matching trace, alerts watch a metric for a threshold breach, and schedules send something on a recurring schedule. The type fixes what you fill out below."
      accordion={accordion}
      // A type is always chosen, so the check reads as "you've decided this".
      complete
      summary={activeTitle}
    >
      <HStack gap={2} align="stretch">
        {TYPES.map((t) => {
          const active = draft.source === t.source;
          return (
            <SourceCard
              key={t.source}
              active={active}
              title={t.title}
              description={t.description}
              accent={t.accent}
              icon={t.icon}
              locked={sourceLocked && !active}
              lockedTooltip={t.lockedTooltip}
              onClick={() => pick(t.source)}
            />
          );
        })}
      </HStack>
    </FacetSection>
  );
}
