import { HStack, SimpleGrid, Text } from "@chakra-ui/react";
import { LayoutGrid, List as ListIcon } from "lucide-react";

import { SegmentedControl } from "~/components/ui/segmented-control";

import { AgentCard } from "./AgentCard";
import { AgentsTable } from "./AgentsTable";
import type { GovernanceAgentRow } from "./agentRows";

/**
 * The two ways the fleet can be drawn, the switch between them, and the branch
 * that picks one.
 *
 * THE DEFAULT IS THE LIST. The page answers "what is running against this
 * organization", which is a comparison across agents; a grid of cards spends a
 * panel on each one and turns ten agents into a scroll. The cards are still
 * here for reading a single agent closely, one press away.
 *
 * The control, its two words and its two glyphs are the inventory catalog's,
 * deliberately (`CatalogLayoutControl` in the inventory page). A reader who
 * learned the switch on one governance screen finds the same switch, saying
 * the same words, on this one. Only the default differs, and it differs
 * because the question each page is opened with does.
 *
 * The branch lives here rather than in the page for the same reason the
 * catalog's does: the page has two places that render agents — the pane and,
 * one day, anything else that lists them — and pushing the branch up would put
 * the same `if` in both.
 *
 * Spec: specs/ai-governance/dashboard/agents-page.feature
 */

export type AgentsLayout = "list" | "grid";

/** What the page shows a reader who has expressed no preference. */
export const DEFAULT_AGENTS_LAYOUT: AgentsLayout = "list";

const AGENTS_LAYOUTS: readonly AgentsLayout[] = ["list", "grid"];

/** Whether an address's `view` value names a layout this page has. */
export const isAgentsLayout = (value: string | null): value is AgentsLayout =>
  AGENTS_LAYOUTS.some((layout) => layout === value);

/** The list/grid switch. Never a native select. */
export function AgentsLayoutControl({
  layout,
  onChange,
}: {
  layout: AgentsLayout;
  onChange: (layout: AgentsLayout) => void;
}) {
  return (
    <SegmentedControl
      size="sm"
      value={layout}
      onValueChange={({ value }) => onChange(value as AgentsLayout)}
      aria-label="Agents layout"
      items={[
        {
          value: "list",
          label: (
            <HStack gap={1.5}>
              <ListIcon size={13} />
              <Text as="span">List</Text>
            </HStack>
          ),
        },
        {
          value: "grid",
          label: (
            <HStack gap={1.5}>
              <LayoutGrid size={13} />
              <Text as="span">Grid</Text>
            </HStack>
          ),
        },
      ]}
    />
  );
}

/** The agents on screen, in whichever layout the reader has chosen. */
export function AgentsList({
  agents,
  layout,
  sample = false,
}: {
  agents: readonly GovernanceAgentRow[];
  layout: AgentsLayout;
  sample?: boolean;
}) {
  if (layout === "list") {
    return <AgentsTable agents={agents} sample={sample} />;
  }

  return (
    <SimpleGrid
      data-testid="governance-agent-cards"
      data-layout={layout}
      columns={{ base: 1, xl: 2 }}
      gap={3}
    >
      {agents.map((agent) => (
        <AgentCard key={agent.id} agent={agent} sample={sample} />
      ))}
    </SimpleGrid>
  );
}
