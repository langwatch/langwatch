import {
  Box,
  Button,
  Heading,
  HStack,
  SimpleGrid,
  Tabs,
  VStack,
} from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { useSearchParams } from "react-router";

import {
  AGENTS_EMPTY_COPY,
  AgentCard,
  AgentFilterBar,
  type AgentFilters,
  APPLICATIONS_EMPTY_COPY,
  applyAgentFilters,
  type GovernanceAgentRow,
  type GovernanceEmptyStateCopy,
  NO_MATCHING_AGENTS_COPY,
  RegisterAgentDialog,
  SAMPLE_AGENT_ROWS,
  sourcesPresentIn,
  useAgentFilters,
} from "~/components/governance/agents";
import {
  GovernanceEmptyState,
  GovernanceEmptyStateAction,
} from "~/components/governance/empty";
import GovernanceLayout from "~/components/governance/GovernanceLayout";
import {
  SampleDataBanner,
  SampleDataToggle,
  useSampleMode,
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

/**
 * One empty state, given the page's own words.
 *
 * Every one of these carries an action, because the dashed box it replaces
 * left the reader exactly where they were. The copy lives in `emptyStates.ts`
 * and the shape is shared with the inventory; see
 * `~/components/governance/empty`.
 */
function AgentsEmptyState({
  copy,
  onAct,
  testId,
}: {
  copy: GovernanceEmptyStateCopy;
  onAct: () => void;
  testId: string;
}) {
  return (
    <GovernanceEmptyState
      icon={copy.icon}
      headline={copy.headline}
      description={copy.description}
      testId={testId}
      action={
        // Weight comes from the descriptor, never from this call site: every
        // state passing through here would otherwise take the component's
        // default and draw "Clear filters" as loudly as "Register agent".
        <GovernanceEmptyStateAction emphasis={copy.emphasis} onClick={onAct}>
          {copy.actionLabel}
        </GovernanceEmptyStateAction>
      }
    />
  );
}

/**
 * The Agents tab: the cards, and whatever stands in for them.
 *
 * The filter row is deliberately NOT here. It belongs to the page header, one
 * row under the title, so the controls that narrow the content sit outside the
 * content they narrow — the same arrangement the api keys page uses, where the
 * scope filter and the create action share a header row above a table that
 * always renders. See `AgentsPage`.
 */
function AgentsPane({
  rows,
  filters,
  sample,
  onRegister,
  onClearFilters,
}: {
  rows: readonly GovernanceAgentRow[];
  filters: AgentFilters;
  sample: boolean;
  onRegister: () => void;
  onClearFilters: () => void;
}) {
  const visible = applyAgentFilters(rows, filters);

  if (visible.length > 0) {
    return (
      <SimpleGrid columns={{ base: 1, xl: 2 }} gap={3}>
        {visible.map((agent) => (
          <AgentCard key={agent.id} agent={agent} sample={sample} />
        ))}
      </SimpleGrid>
    );
  }

  // Two different nothings, and they must never borrow each other's words.
  // Telling a reader who has ten agents and a narrow filter to go register one
  // is the page failing to understand its own state, so the branch is on why
  // the list is empty rather than on the fact that it is.
  return rows.length === 0 ? (
    <AgentsEmptyState
      copy={AGENTS_EMPTY_COPY}
      onAct={onRegister}
      testId="agents-empty"
    />
  ) : (
    <AgentsEmptyState
      copy={NO_MATCHING_AGENTS_COPY}
      onAct={onClearFilters}
      testId="agents-no-match"
    />
  );
}

function AgentsPage() {
  const { agentsTab, selectAgentsTab } = useAgentsTab();
  const { open: registerOpen, setOpen: setRegisterOpen } = useRegisterDialog();
  const sample = useSampleMode();
  const { filters, setFilter, clearFilters } = useAgentFilters();
  const rows = sample.active ? SAMPLE_AGENT_ROWS : [];
  // Gated on the unfiltered set, never the visible one: a reader who filters
  // down to nothing must still have the chip that gets them back. The
  // Applications tab has nothing to filter, so the row is the Agents tab's.
  const showFilters = agentsTab === "agents" && rows.length > 0;

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
          {/* Out of the content and into the header, one row under the tabs.
              Controls that narrow what is below should not live inside the
              thing they narrow — the api keys page pairs its scope filter with
              its create action above a table for the same reason. */}
          {showFilters && (
            <Box paddingTop={4}>
              <AgentFilterBar
                filters={filters}
                sources={sourcesPresentIn(rows)}
                onSourceChange={(value) => setFilter("source", value)}
                onOwnershipChange={(value) => setFilter("ownership", value)}
                onSortChange={(value) => setFilter("sort", value)}
              />
            </Box>
          )}
          <Tabs.Content value="agents" paddingTop={4}>
            <AgentsPane
              rows={rows}
              filters={filters}
              sample={sample.active}
              onRegister={() => setRegisterOpen(true)}
              onClearFilters={clearFilters}
            />
          </Tabs.Content>
          <Tabs.Content value="applications" paddingTop={4}>
            {/* Registering an agent, not creating an application: an
                application is the group an agent already belongs to, so a
                "Create application" button here could not work. */}
            <AgentsEmptyState
              copy={APPLICATIONS_EMPTY_COPY}
              onAct={() => setRegisterOpen(true)}
              testId="applications-empty"
            />
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
