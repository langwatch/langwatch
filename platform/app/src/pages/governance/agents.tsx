import { Box, Heading, Tabs, Text, VStack } from "@chakra-ui/react";
import { useSearchParams } from "react-router";

import GovernanceLayout from "~/components/governance/GovernanceLayout";
import { withFeatureFlagGuard } from "~/components/WithFeatureFlagGuard";
import { withPermissionGuard } from "~/components/WithPermissionGuard";

/**
 * The Agents page: what runs against the organization, as two tabs —
 * Agents (the agents detected through the connected sources) and
 * Applications (the applications those agents belong to).
 *
 * No organization-wide list exists yet: every agents procedure is scoped to
 * a project, and the governance routers list sources, rules and people, not
 * agents. Until one lands, each tab is an honest empty state — no query, no
 * invented rows — so the rail shape ships ahead of the data, the way Costs
 * did.
 *
 * Spec: specs/ai-gateway/governance/governance-home-routing.feature
 * (the agents page section).
 */

const AGENTS_TABS = ["agents", "applications"] as const;
type AgentsTab = (typeof AGENTS_TABS)[number];
const DEFAULT_TAB: AgentsTab = "agents";

const isAgentsTab = (value: string | null): value is AgentsTab =>
  AGENTS_TABS.some((tab) => tab === value);

/**
 * A selected non-default tab is part of the address (?tab=); the default
 * stays out of it, and an unknown or stale value degrades to the default
 * instead of a blank pane. Same contract as the inventory tabs.
 */
function useAgentsTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const agentsTab = isAgentsTab(requestedTab) ? requestedTab : DEFAULT_TAB;
  const selectAgentsTab = (tab: string) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (tab === DEFAULT_TAB) next.delete("tab");
        else next.set("tab", tab);
        return next;
      },
      { replace: true },
    );
  return { agentsTab, selectAgentsTab };
}

function EmptyPane({ children }: { children: string }) {
  return (
    <Box
      borderWidth="1px"
      borderStyle="dashed"
      borderColor="border"
      borderRadius="md"
      paddingY={10}
      paddingX={6}
      textAlign="center"
    >
      <Text color="fg.muted">{children}</Text>
    </Box>
  );
}

function AgentsPage() {
  const { agentsTab, selectAgentsTab } = useAgentsTab();
  return (
    <GovernanceLayout pageTitle="Agents · AI Governance · LangWatch">
      <VStack align="stretch" gap={6} width="full" maxW="container.xl">
        <Heading size="md">Agents</Heading>
        <Tabs.Root
          value={agentsTab}
          onValueChange={({ value }) => selectAgentsTab(value)}
          variant="line"
          lazyMount
        >
          <Tabs.List>
            <Tabs.Trigger
              value="agents"
              color="fg.muted"
              _selected={{ color: "fg", fontWeight: "semibold" }}
            >
              Agents
            </Tabs.Trigger>
            <Tabs.Trigger
              value="applications"
              color="fg.muted"
              _selected={{ color: "fg", fontWeight: "semibold" }}
            >
              Applications
            </Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="agents" paddingTop={4}>
            <EmptyPane>
              Agents appear here as they are detected across the organization's
              connected sources.
            </EmptyPane>
          </Tabs.Content>
          <Tabs.Content value="applications" paddingTop={4}>
            <EmptyPane>
              Applications appear here as they are detected across the
              organization's connected sources.
            </EmptyPane>
          </Tabs.Content>
        </Tabs.Root>
      </VStack>
    </GovernanceLayout>
  );
}

export default withFeatureFlagGuard("release_ui_ai_governance_enabled", {
  bypassOnboardingRedirect: true,
})(
  withPermissionGuard("governance:view", {
    bypassOnboardingRedirect: true,
  })(AgentsPage),
);
