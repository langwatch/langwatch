import { HStack, SimpleGrid, Text } from "@chakra-ui/react";
import { SegmentedControl } from "@langwatch/design-system/segmented-control";
import type { GovernanceAgentRow } from "@langwatch/enterprise-governance-contract";
import { LayoutGrid, List as ListIcon } from "lucide-react";

import { AgentCard } from "./agent-card";
import { AgentsTable } from "./agents-table";

/**
 * The fleet's two layouts, the switch and the branch. The list is the default because the page
 * compares agents; the switch mirrors the inventory catalog's `CatalogLayoutControl`.
 * @see specs/ai-governance/dashboard/agents-page.feature
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
