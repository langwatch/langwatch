import { HStack } from "@chakra-ui/react";
import { Calendar, TrendingUp, Zap } from "lucide-react";
import type { ReactNode } from "react";
import type { FacetAccordionProps } from "../elements/facet-section";
import { FacetSection } from "../elements/facet-section";
import { SourceCard } from "../elements/source-card";

export type AutomationSource = "trace" | "customGraph" | "report";

/** The three presets, in ADR-043 order, each with its list-page accent. */
const TYPES: {
  source: AutomationSource;
  title: string;
  description: string;
  accent: string;
  icon: ReactNode;
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
 * Controlled Type facet. The host owns the draft and applies the source
 * transition so the package does not depend on a store, router, or Prisma.
 */
export function AutomationTypePicker({
  source,
  sourceLocked = false,
  accordion,
  onChange,
}: {
  source: AutomationSource;
  sourceLocked?: boolean;
  accordion?: FacetAccordionProps;
  onChange: (source: AutomationSource) => void;
}) {
  const activeTitle = TYPES.find((t) => t.source === source)?.title ?? "";

  return (
    <FacetSection
      title="Type"
      help="Automations act on each matching trace, alerts watch a metric for a threshold breach, and schedules send something on a recurring schedule. The type fixes what you fill out below."
      accordion={accordion}
      complete
      summary={activeTitle}
    >
      <HStack gap={2} align="stretch">
        {TYPES.map((type) => {
          const active = source === type.source;
          return (
            <SourceCard
              key={type.source}
              active={active}
              title={type.title}
              description={type.description}
              accent={type.accent}
              icon={type.icon}
              locked={sourceLocked && !active}
              lockedTooltip={type.lockedTooltip}
              onClick={() => onChange(type.source)}
            />
          );
        })}
      </HStack>
    </FacetSection>
  );
}
