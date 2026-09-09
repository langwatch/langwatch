import { Heading, HStack, VStack } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { useSearchParams } from "react-router";

import {
  AGENTS_EMPTY_COPY,
  AgentFilterBar,
  type AgentFilters,
  AgentFleetSummaryStrip,
  type AgentsLayout,
  AgentsLayoutControl,
  AgentsList,
  applyAgentFilters,
  DEFAULT_AGENTS_LAYOUT,
  type GovernanceAgentRow,
  type GovernanceEmptyStateCopy,
  isAgentsLayout,
  NO_MATCHING_AGENTS_COPY,
  RegisterAgentDialog,
  SAMPLE_AGENT_ROWS,
  sourcesPresentIn,
  summarizeAgentFleet,
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
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { withFeatureFlagGuard } from "~/components/WithFeatureFlagGuard";
import { withPermissionGuard } from "~/components/WithPermissionGuard";

/**
 * The Agents page: what runs against the organization, as one list.
 *
 * ONE SURFACE, NOT TWO. It carried an Applications tab beside the agents until
 * the product owner asked for it gone. The pane behind it read nothing and
 * listed nothing — it was a fixed empty state waiting for a concept the
 * platform does not model yet — so it was a second tab a reader could press
 * and learn nothing from. With one pane left there is nothing to switch
 * between, so the tab strip went with it and the agents are the page.
 *
 * No organization-wide list exists yet. Every agents procedure the platform
 * has is project-scoped (`agents.getAll`, permission `evaluations:view`), and
 * the governance section is organization-scoped, so reading one project's
 * agents here and labelling them as the organization's would be a lie told in
 * the house typeface. The page therefore issues no query at all: with sample
 * mode off it is an honest empty state, and with it on the rows are invented
 * and say so, per row. When an organization-wide read lands it fills
 * `GovernanceAgentRow` and the list stops caring where the rows came from.
 *
 * THE LIST IS THE DEFAULT AND THE CARDS ARE THE OPTION. An admin arrives
 * asking what is running across the organization, which is a comparison; the
 * card grid answered it a panel at a time. The switch between them is the
 * inventory catalog's control, down to its words — see `AgentsList`.
 *
 * Registering is not a form. ADR-128 makes a connected agent register itself
 * from the process that runs it, and the platform refuses to create one any
 * other way (`agent_register_only`), so the action opens the snippet that
 * actually works rather than fields nothing could persist.
 *
 * The summary strip obeys the same constraint as everything else here. It
 * measures nothing of its own: every figure on it is a fold over the rows
 * below it (`summarizeAgentFleet`), so it cannot become a second, quieter
 * place where invented numbers pass as measured ones, and it cannot drift from
 * the list it summarizes. It is gated on having rows rather than on sample
 * mode — the same gate the filter chips and the layout switch use — so with
 * nothing to summarize it is absent rather than showing four em dashes, and
 * when an organization-wide read lands it lights up unchanged. Absent rather
 * than dashed because the pane below already says in a full sentence that no
 * agent has registered; four empty boxes above that sentence would repeat it
 * without adding to it.
 *
 * Specs: specs/ai-governance/dashboard/agents-page.feature,
 * specs/ai-gateway/governance/governance-home-routing.feature (the address),
 * specs/ai-governance/dashboard/governance-ui-controls.feature (the rulebook)
 */

/**
 * Which layout the reader chose, as part of the address (`?view=`).
 *
 * The default stays out of the address and an unknown value degrades to it
 * rather than to a blank pane — the contract the tab parameter had before the
 * tabs were removed, and the one every other control on this page already
 * follows. The filters, the sort and the register dialog are all in the
 * address here, so leaving the one remaining control in component state would
 * make it the single choice on the page a reader could not share or reload
 * into.
 */
function useAgentsLayout() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get("view");
  const layout = isAgentsLayout(requested) ? requested : DEFAULT_AGENTS_LAYOUT;
  const selectLayout = (next: AgentsLayout) =>
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next === DEFAULT_AGENTS_LAYOUT) params.delete("view");
        else params.set("view", next);
        return params;
      },
      { replace: true },
    );
  return { layout, selectLayout };
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
 * The agents, and whatever stands in for them.
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
  layout,
  sample,
  onRegister,
  onClearFilters,
}: {
  rows: readonly GovernanceAgentRow[];
  filters: AgentFilters;
  layout: AgentsLayout;
  sample: boolean;
  onRegister: () => void;
  onClearFilters: () => void;
}) {
  const visible = applyAgentFilters(rows, filters);

  if (visible.length > 0) {
    return <AgentsList agents={visible} layout={layout} sample={sample} />;
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
  const { layout, selectLayout } = useAgentsLayout();
  const { open: registerOpen, setOpen: setRegisterOpen } = useRegisterDialog();
  const sample = useSampleMode();
  const { filters, setFilter, clearFilters } = useAgentFilters();
  const rows = sample.active ? SAMPLE_AGENT_ROWS : [];
  // Gated on the unfiltered set, never the visible one: a reader who filters
  // down to nothing must still have the chip that gets them back. The layout
  // switch takes the same gate, because there is nothing to lay out either
  // way until a row exists.
  const showControls = rows.length > 0;
  // Over the whole fleet, not the filtered view — see `summarizeAgentFleet`.
  const summary = rows.length > 0 ? summarizeAgentFleet({ rows }) : null;

  return (
    <GovernanceLayout pageTitle="Agents · AI Governance · LangWatch">
      <VStack align="stretch" gap={5} width="full" maxW="container.xl">
        <HStack justify="space-between" align="center">
          <Heading size="md">Agents</Heading>
          <HStack gap={2}>
            {/* Same corner and same order as the inventory's header: how the
                content is drawn, then whether it is invented, then the one
                thing this page is for adding. */}
            {showControls && (
              <AgentsLayoutControl layout={layout} onChange={selectLayout} />
            )}
            <SampleDataToggle
              active={sample.active}
              onToggle={sample.toggle}
              size="sm"
            />
            {/* The action that creates this page's own thing, drawn as the
                house header button — outline, small, leading plus glyph, the
                same control /settings/model-providers uses for "Add Model
                Provider". It was a solid orange button until the section-wide
                pass that took solid orange off these pages; the brand accent
                now marks only the sample affordances, which is the one thing
                on the screen it needs to distinguish.
                Rule: specs/ai-governance/dashboard/governance-ui-controls.feature */}
            <PageLayout.HeaderButton onClick={() => setRegisterOpen(true)}>
              <Plus size={14} />
              Register agent
            </PageLayout.HeaderButton>
          </HStack>
        </HStack>
        {sample.active && (
          <SampleDataBanner>
            These agents are an illustration of what this page will hold —
            nothing here is real.
          </SampleDataBanner>
        )}
        {/* Under the banner, above the chips. Under the banner because every
            figure on it is invented while sample mode is on, and the banner is
            the page's one claim about the whole screen; above the chips
            because the strip summarizes the fleet rather than whatever the
            chips have left of it. */}
        {summary && <AgentFleetSummaryStrip summary={summary} />}
        {/* Out of the content and into the header. Controls that narrow what
            is below should not live inside the thing they narrow — the api
            keys page pairs its scope filter with its create action above a
            table for the same reason. */}
        {showControls && (
          <AgentFilterBar
            filters={filters}
            sources={sourcesPresentIn(rows)}
            onSourceChange={(value) => setFilter("source", value)}
            onOwnershipChange={(value) => setFilter("ownership", value)}
            onSortChange={(value) => setFilter("sort", value)}
          />
        )}
        <AgentsPane
          rows={rows}
          filters={filters}
          layout={layout}
          sample={sample.active}
          onRegister={() => setRegisterOpen(true)}
          onClearFilters={clearFilters}
        />
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
