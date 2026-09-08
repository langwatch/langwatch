import {
  Box,
  Button,
  Heading,
  HStack,
  SimpleGrid,
  Tabs,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { useSearchParams } from "react-router";

import {
  AgentCard,
  AgentFilterBar,
  applyAgentFilters,
  RegisterAgentDialog,
  SAMPLE_AGENT_ROWS,
  sourcesPresentIn,
  useAgentFilters,
} from "~/components/governance/agents";
import GovernanceLayout from "~/components/governance/GovernanceLayout";
import {
  SampleDataBanner,
  SampleDataToggle,
  useSampleMode,
  useSettledRealDataState,
} from "~/components/governance/sample";
import { withFeatureFlagGuard } from "~/components/WithFeatureFlagGuard";
import { withPermissionGuard } from "~/components/WithPermissionGuard";

/**
 * The Agents page: what runs against the organization, as two tabs —
 * Agents (the agents detected through the connected sources) and
 * Applications (the applications those agents belong to).
 *
 * No organization-wide list exists yet. Every agents procedure the platform
 * has is project-scoped (`agents.getAll`, permission `evaluations:view`), and
 * the governance section is organization-scoped, so reading one project's
 * agents here and labelling them as the organization's would be a lie told in
 * the house typeface. The page therefore issues no query at all: with sample
 * mode off each pane is an honest empty state, and with it on the cards are
 * invented and say so, per card. When an organization-wide read lands it fills
 * `GovernanceAgentRow` and the cards stop caring where the rows came from.
 *
 * Registering is not a form. ADR-128 makes a connected agent register itself
 * from the process that runs it, and the platform refuses to create one any
 * other way (`agent_register_only`), so the action opens the snippet that
 * actually works rather than fields nothing could persist.
 *
 * Specs: specs/ai-governance/dashboard/agents-page.feature,
 * specs/ai-gateway/governance/governance-home-routing.feature (the tab shell),
 * specs/ai-governance/dashboard/governance-ui-controls.feature (the rulebook)
 */

const AGENTS_TABS = ["agents", "applications"] as const;
type AgentsTab = (typeof AGENTS_TABS)[number];
const DEFAULT_TAB: AgentsTab = "agents";

/**
 * The page has no reads. Held as one constant rather than a fresh literal per
 * render so the settled-state hook is not handed a new array every time.
 */
const NO_READS: ReadonlyArray<{ length: number } | null> = [];

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

/**
 * Whether the register dialog is open, as part of the address.
 *
 * The governance home page offers an "Add agent" pill that lands here, and a
 * pill that dropped the reader on the page and left them to find the button
 * again would be a worse version of no pill at all. `?add=1` is the whole
 * contract: present means open, and closing takes it back out so a refresh or
 * a shared link does not reopen a dialog the reader already dismissed.
 */
function useRegisterDialog() {
  const [searchParams, setSearchParams] = useSearchParams();
  const open = searchParams.get("add") === "1";
  const setOpen = (nowOpen: boolean) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (nowOpen) next.set("add", "1");
        else next.delete("add");
        return next;
      },
      { replace: true },
    );
  return { open, setOpen };
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

/**
 * The Agents tab: the filter row and the cards under it.
 *
 * The filter row renders only when there is something to filter, and it is
 * gated on the unfiltered set rather than the visible one — a reader who
 * filters down to nothing must still have the chip that gets them back.
 */
function AgentsPane({ sample }: { sample: boolean }) {
  const { filters, setFilter } = useAgentFilters();
  const rows = sample ? SAMPLE_AGENT_ROWS : [];
  const visible = applyAgentFilters(rows, filters);

  return (
    <VStack align="stretch" gap={4}>
      {rows.length > 0 && (
        <AgentFilterBar
          filters={filters}
          sources={sourcesPresentIn(rows)}
          onSourceChange={(value) => setFilter("source", value)}
          onOwnershipChange={(value) => setFilter("ownership", value)}
          onSortChange={(value) => setFilter("sort", value)}
        />
      )}
      {visible.length === 0 ? (
        <EmptyPane>
          {rows.length === 0
            ? "Agents appear here as they are detected across the organization's connected sources."
            : "No agent matches these filters."}
        </EmptyPane>
      ) : (
        <SimpleGrid columns={{ base: 1, xl: 2 }} gap={3}>
          {visible.map((agent) => (
            <AgentCard key={agent.id} agent={agent} sample={sample} />
          ))}
        </SimpleGrid>
      )}
    </VStack>
  );
}

function AgentsPage() {
  const { agentsTab, selectAgentsTab } = useAgentsTab();
  const { open: registerOpen, setOpen: setRegisterOpen } = useRegisterDialog();
  const realData = useSettledRealDataState(NO_READS);
  const sample = useSampleMode({
    realData,
  });

  return (
    <GovernanceLayout pageTitle="Agents · AI Governance · LangWatch">
      <VStack align="stretch" gap={5} width="full" maxW="container.xl">
        <HStack justify="space-between" align="center">
          <Heading size="md">Agents</Heading>
          <HStack gap={2}>
            <SampleDataToggle
              active={sample.active}
              onToggle={sample.toggle}
              size="sm"
            />
            {/* The action that creates this page's own thing, so it is the
                solid one, in the brand palette — the same treatment the
                inventory gives "Add tool". Solid is stated rather than left
                to the default so the rule is legible here, not only in the
                test that pins it.
                Rule: specs/ai-governance/dashboard/governance-ui-controls.feature */}
            <Button
              size="sm"
              variant="solid"
              colorPalette="orange"
              onClick={() => setRegisterOpen(true)}
            >
              <Plus size={14} />
              Register agent
            </Button>
          </HStack>
        </HStack>
        {sample.active && (
          <SampleDataBanner>
            These agents are an illustration of what this page will hold —
            nothing here is real.
          </SampleDataBanner>
        )}
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
            <AgentsPane sample={sample.active} />
          </Tabs.Content>
          <Tabs.Content value="applications" paddingTop={4}>
            <EmptyPane>
              Applications appear here as they are detected across the
              organization's connected sources.
            </EmptyPane>
          </Tabs.Content>
        </Tabs.Root>
      </VStack>
      <RegisterAgentDialog
        open={registerOpen}
        onClose={() => setRegisterOpen(false)}
      />
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
