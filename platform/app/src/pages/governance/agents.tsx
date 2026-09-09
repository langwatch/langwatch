import { Box, Heading, HStack, Spinner, VStack } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import {
  AGENTS_EMPTY_COPY,
  AgentFilterBar,
  type AgentFilters,
  AgentFleetSummaryStrip,
  type AgentsLayout,
  AgentsLayoutControl,
  AgentsList,
  agentsUnlistedCopy,
  applyAgentFilters,
  DEFAULT_AGENTS_LAYOUT,
  type GovernanceAgentRow,
  type GovernanceEmptyStateCopy,
  isAgentsLayout,
  NO_MATCHING_AGENTS_COPY,
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
import {
  GovernanceSyncButton,
  governanceSyncStatus,
} from "~/components/governance/sync";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { toaster } from "~/components/ui/toaster";
import { withFeatureFlagGuard } from "~/components/WithFeatureFlagGuard";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { HandledErrorAlert, showErrorToast } from "~/features/errors";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

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
 * THE ROWS ARE REAL NOW, from `governanceAgents.list`. It reads two tables at
 * organization scope: agents that registered themselves from code (ADR-128)
 * and agents a connected provider was asked to list. The page used to fetch
 * nothing at all, because the only agents procedure the platform had was
 * project-scoped (`agents.getAll`) and calling one project's agents the
 * organization's would have been a lie told in the house typeface.
 *
 * Real rows carry no spend, no request count and no health, because no read
 * measures those per agent yet. They arrive null and the list draws a dash
 * with the reason on it, which is the same rendering the sample set's
 * never-run agent already proved.
 *
 * SAMPLE MODE IS AN EITHER-OR, never a fallback. With it on the page shows the
 * invented set and says so; with it off the page shows what the read returned,
 * including nothing. A real empty result never quietly fills with samples: a
 * reader cannot act on invented figures, and cannot tell they are invented if
 * they arrived because the real answer was empty. For the same reason the
 * spinner and the failure alert are suppressed while sample mode is on, which
 * is the stance the inventory and people pages already take.
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

/** The address that opens the register-agent drawer on arrival. */
const ADD_AGENT_PARAM = "add";

/**
 * The deep link that arrives asking to register an agent:
 * `/governance/agents?add=1`, which is how the governance home page's "Add
 * agent" pill sends a reader here. A pill that dropped the reader on the page
 * and left them to find the button again would be a worse version of no pill
 * at all.
 *
 * The parameter is a request, not state. It is honoured once, and then cleared
 * from the address on the render after the drawer has landed in it — reading
 * `drawer.open` rather than latching a flag, so the clear cannot run before the
 * open it is waiting for. Same contract, same parameter name and the same
 * shape as the people page's `useAddDepartmentDeepLink`, because it is the
 * same problem: a short href another screen can hold, translated into the
 * drawer address the registry actually routes on.
 *
 * Unlike that one this has no permission gate. The department deep link checks
 * `governance:manage` because the mutation behind its drawer would refuse the
 * reader anyway; there is no mutation behind this one. It shows the snippet a
 * reader runs in their own process, so anyone who can see this page can read
 * it.
 */
function useAddAgentDeepLink() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { openDrawer } = useDrawer();

  const requested = searchParams.get(ADD_AGENT_PARAM) === "1";
  const drawerOpen = searchParams.get("drawer.open");
  const opened = useRef(false);

  useEffect(() => {
    if (!requested) {
      opened.current = false;
      return;
    }

    if (drawerOpen === "addAgent") {
      setSearchParams(
        (previous) => {
          const params = new URLSearchParams(previous);
          params.delete(ADD_AGENT_PARAM);
          return params;
        },
        { replace: true },
      );
      return;
    }
    if (opened.current) return;
    opened.current = true;
    openDrawer("addAgent");
  }, [requested, drawerOpen, openDrawer, setSearchParams]);
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
  actionDisabled = false,
  testId,
}: {
  copy: GovernanceEmptyStateCopy;
  onAct: () => void;
  /**
   * The pane's action is a second doorway to a control in the header, so it
   * has to be shut whenever that control is. An empty state offering a press
   * the header has already disabled is the same defect as a live button that
   * silently does nothing, moved down the page.
   */
  actionDisabled?: boolean;
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
        <GovernanceEmptyStateAction
          emphasis={copy.emphasis}
          onClick={onAct}
          disabled={actionDisabled}
        >
          {copy.actionLabel}
        </GovernanceEmptyStateAction>
      }
    />
  );
}

/**
 * What the page reads, and what it shows given the reader's sample choice.
 *
 * Gathered here so the page body does not have to be read as a chain: the
 * query depends on the organization, and which rows reach the list depends on
 * the query and on the sample choice.
 *
 * The two never mix. Sample mode substitutes the invented set wholesale; it is
 * never a fallback for a real read that came back empty or failed. An empty
 * organization filling itself with plausible agents would be a page a reader
 * cannot act on and cannot tell apart from one they can.
 */
function useAgentsScreen() {
  const { organization } = useOrganizationTeamProject({
    redirectToOnboarding: false,
  });
  const orgId = organization?.id ?? "";
  const sample = useSampleMode();

  const agents = api.governanceAgents.list.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId, refetchOnWindowFocus: false },
  );

  return {
    sample,
    rows: sample.active ? SAMPLE_AGENT_ROWS : (agents.data ?? []),
    // Both suppressed under sample mode, for the reason the people page
    // suppresses its own: reporting that the real read is still running, or
    // that it failed, beside a screen full of invented figures leaves the
    // reader unable to act on either half.
    isLoading: !sample.active && !!orgId && agents.isLoading,
    error: sample.active ? null : agents.error,
  };
}

/**
 * Asking the connected providers what agents they have.
 *
 * ASYNCHRONOUS, and everything below follows from that. The mutation returns
 * when the request has been RECORDED. A pipeline calls the provider after
 * that, and the answer reaches this page only through the next read. So this
 * hook reports what was started and never what was found, and the toast says
 * reloading is how the reader sees a result.
 *
 * `asked` is remembered for the life of the mounted page rather than timed
 * out. A second request arriving while one is in flight is DROPPED by the
 * process manager, not queued, and this page still has no way to learn when
 * the first one settled.
 *
 * The reason for that has moved. It is no longer that the outcome is unfolded:
 * `IngestionPullRunStatusFoldProjection` folds all four listing outcome events
 * into eleven columns on the pull-run-status row, so when a listing settled,
 * and with what outcome, is recorded per source. What is missing is a READ —
 * no repository method, service or `governanceAgents` procedure returns
 * `LastAgentsListingAt` or `LastAgentsListingOutcome` — so this hook has
 * nothing to poll or compare against. Until one exists, a timer would still be
 * a guess at when pressing works again; a reload is the thing that actually
 * shows the result, and it clears this too.
 *
 * The sources read is on the view grant and runs for every reader, because the
 * empty pane needs to name the connected providers whether or not the reader
 * may press anything.
 */
function useAgentSync({
  orgId,
  canManage,
}: {
  orgId: string;
  canManage: boolean;
}) {
  const [asked, setAsked] = useState(false);
  const sources = api.governanceAgents.syncSources.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId, refetchOnWindowFocus: false },
  );
  const mutation = api.governanceAgents.requestListing.useMutation({
    onSuccess: (result) => {
      setAsked(true);
      toaster.create({
        title: "Sync requested",
        // What was asked, not what was found. The providers have not answered
        // yet and this page will not notice when they do.
        description: `Asked ${result.requested} ${
          result.requested === 1 ? "provider" : "providers"
        } to list their agents. Reload this page in a moment to see what came back.`,
        type: "success",
      });
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't request a sync" }),
  });

  const connected = sources.data ?? [];
  const status = governanceSyncStatus({
    canManage,
    sourcesLoading: sources.isLoading,
    sourceCount: connected.length,
    isAsking: mutation.isPending,
    asked,
  });

  return {
    connected,
    state: status.state,
    // Every unpressable state carries its own sentence, in this page's words.
    // A disabled control with no reason is indistinguishable from a broken
    // one, so the cause and the sentence are decided together here rather
    // than left to whichever call site draws the button.
    reason:
      status.state === "asked"
        ? "Already asked. Reload the page to see what the providers reported."
        : status.state !== "unavailable"
          ? null
          : AGENT_SYNC_UNAVAILABLE_REASONS[status.because],
    press: () => {
      if (status.state !== "ready") return;
      mutation.mutate({ organizationId: orgId });
    },
  };
}

/** One sentence per way of not being pressable. See `governanceSyncStatus`. */
const AGENT_SYNC_UNAVAILABLE_REASONS = {
  no_grant: "Only an administrator can ask a provider to list its agents.",
  checking: "Checking which providers can list agents.",
  no_provider: "No connected provider can list agents.",
} as const;

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
  isLoading,
  noAgents,
  onClearFilters,
}: {
  rows: readonly GovernanceAgentRow[];
  filters: AgentFilters;
  layout: AgentsLayout;
  sample: boolean;
  isLoading: boolean;
  /**
   * What to show when the organization holds no agents at all, decided by the
   * page rather than here. Which nothing this is depends on whether a provider
   * that can list agents is connected, which is a read this pane does not
   * make; the words and the press travel together so a state cannot arrive
   * with the other page's action attached to it.
   */
  noAgents: {
    copy: GovernanceEmptyStateCopy;
    onAct: () => void;
    actionDisabled: boolean;
    testId: string;
  };
  onClearFilters: () => void;
}) {
  const visible = applyAgentFilters(rows, filters);

  // Ahead of both empty states, because "no agent has registered yet" is a
  // claim about the organization and a read still in flight has not earned it.
  if (isLoading) {
    return (
      <Box padding={6}>
        <Spinner />
      </Box>
    );
  }

  if (visible.length > 0) {
    return <AgentsList agents={visible} layout={layout} sample={sample} />;
  }

  // Two different nothings, and they must never borrow each other's words.
  // Telling a reader who has ten agents and a narrow filter to go register one
  // is the page failing to understand its own state, so the branch is on why
  // the list is empty rather than on the fact that it is.
  return rows.length === 0 ? (
    <AgentsEmptyState
      copy={noAgents.copy}
      onAct={noAgents.onAct}
      actionDisabled={noAgents.actionDisabled}
      testId={noAgents.testId}
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
  const { openDrawer } = useDrawer();
  const openRegister = () => openDrawer("addAgent");
  useAddAgentDeepLink();
  const { organization, hasAnyPermission } = useOrganizationTeamProject({
    redirectToOnboarding: false,
  });
  const canManage = hasAnyPermission("governance:manage");
  const sync = useAgentSync({
    orgId: organization?.id ?? "",
    canManage,
  });
  const { sample, rows, isLoading, error } = useAgentsScreen();
  const { filters, setFilter, clearFilters } = useAgentFilters();
  // Gated on the unfiltered set, never the visible one: a reader who filters
  // down to nothing must still have the chip that gets them back. The layout
  // switch takes the same gate, because there is nothing to lay out either
  // way until a row exists.
  const showControls = rows.length > 0;
  // Over the whole fleet, not the filtered view — see `summarizeAgentFleet`.
  const summary = rows.length > 0 ? summarizeAgentFleet({ rows }) : null;
  // WHICH nothing this is. A reader with a provider connected and a reader
  // with none have different moves available, and offering the wrong one is
  // the page failing to notice what it already knows. The third possibility —
  // a provider that refused to answer — still cannot be told apart from an
  // empty tenant here, but the reason is now narrower than it was: the
  // outcome IS folded and stored per source (eleven columns on the
  // pull-run-status row), and what is missing is a read that hands those
  // columns to this screen. Nothing in `governanceAgents` returns them, so
  // there is still nothing to branch on; see `agentsUnlistedCopy`, which is
  // worded so it never claims either.
  const noAgents =
    sync.connected.length > 0
      ? {
          copy: agentsUnlistedCopy({
            providerNames: sync.connected.map((source) => source.name),
            // The sentence follows the grant, not the momentary state of the
            // button: "asking" and "asked" are both readers who may ask.
            canAsk: canManage,
          }),
          onAct: sync.press,
          actionDisabled: sync.state !== "ready",
          testId: "agents-empty-unlisted",
        }
      : {
          copy: AGENTS_EMPTY_COPY,
          onAct: openRegister,
          actionDisabled: false,
          testId: "agents-empty",
        };

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
            {/* Ghost, so the one outlined control in this row stays the action
                that creates something of the organization's own — the same
                arrangement the people header uses for `Run match pass`.
                It is rendered for every reader rather than gated on the manage
                grant, which is where this departs from that header: a reader
                who cannot press it is the one least able to work out why the
                page will not refresh, and a disabled control that says so
                tells them, where an absent one does not. */}
            <GovernanceSyncButton
              label="Sync agents"
              state={sync.state}
              reason={sync.reason}
              onPress={sync.press}
            />
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
            <PageLayout.HeaderButton onClick={openRegister}>
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
        {/* Above the content rather than in place of it. A failed read leaves
            the page with no rows, and the pane below already has a sentence
            for that; what it cannot say is that the emptiness is a failure
            rather than an answer. `useAgentsScreen` has already decided this
            is null under sample mode. */}
        <HandledErrorAlert error={error} fallbackTitle="Couldn't load agents" />
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
          isLoading={isLoading}
          noAgents={noAgents}
          onClearFilters={clearFilters}
        />
      </VStack>
      {/* No drawer is mounted here. `CurrentDrawer` at the app root owns the
          mount and the address owns which one is open, so this page only ever
          asks. */}
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
