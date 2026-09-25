import { Box, Heading, HStack, Spinner, VStack } from "@chakra-ui/react";
import { useDrawer } from "@langwatch/browser-host/drawer";
import { PageLayout } from "@langwatch/design-system/page-layout";
import type { GovernanceAgentRow } from "@langwatch/enterprise-governance-contract";
import type {
  AgentsListingOutcome,
  AgentsListingRefusalCause,
} from "@langwatch/enterprise-governance-contract";
import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { api } from "../../../behavior/governance-api.ts";
import { useGovernanceToaster, useShowErrorToast } from "../../../behavior/governance-feedback.ts";
import { useGovernanceSearchParams } from "../../../behavior/governance-router.ts";
import { useGovernanceScope } from "../../../behavior/governance-session.ts";
import {
  AGENTS_EMPTY_COPY,
  AgentFilterBar,
  type AgentFilters,
  AgentFleetSummaryStrip,
  type AgentsLayout,
  AgentsLayoutControl,
  AgentsList,
  agentsListedEmptyCopy,
  agentsRefusedCopy,
  agentsUnlistedCopy,
  applyAgentFilters,
  DEFAULT_AGENTS_LAYOUT,
  type GovernanceEmptyStateCopy,
  isAgentsLayout,
  NO_MATCHING_AGENTS_COPY,
  SAMPLE_AGENT_ROWS,
  sourcesPresentIn,
  summarizeAgentFleet,
  useAgentFilters,
} from "../../../features/agents/index.ts";
import { GovernanceSyncButton, governanceSyncStatus } from "../../../features/agents/sync/index.ts";
import {
  GovernanceEmptyState,
  GovernanceEmptyStateAction,
} from "../../elements/governance-empty-state.tsx";
import { useSampleMode } from "../../elements/governance-sample-mode.ts";
import { HandledErrorAlert } from "../../elements/handled-error-alert.tsx";
import { SampleDataBanner, SampleDataToggle } from "../../elements/sample-data-controls.tsx";
import GovernanceLayout from "../governance-layout.tsx";

// Agents page: organization-wide list with real rows. Sample mode either-or. List/cards layout.
// Register via snippet (ADR-128). Summary folds from rows.

// Layout part of address (?view=); default hidden, unknown degrades to it. Other controls in
// address so this must be too.
function useAgentsLayout() {
  const [searchParams, setSearchParams] = useGovernanceSearchParams();
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

// Deep link ?add=1 opens register drawer, honored once then cleared. Same pattern as
// people page's useAddDepartmentDeepLink; no permission gate needed.
function useAddAgentDeepLink() {
  const [searchParams, setSearchParams] = useGovernanceSearchParams();
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
 * One empty state, given the page's own words — every one carries an
 * action, because the dashed box it replaces left the reader exactly where
 * they were. Copy lives in `emptyStates.ts`; shape shared with the inventory.
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
   * has to be shut whenever that control is — otherwise it offers a press
   * the header already disabled, the same defect moved down the page.
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

// Reads query and displays based on sample choice. Sample mode substitutes wholesale, never
// fallback for empty/failed reads.
function useAgentsScreen() {
  const { organization } = useGovernanceScope();
  const orgId = organization?.id ?? "";
  const sample = useSampleMode();

  const agents = api.governanceAgents.list.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId, refetchOnWindowFocus: false },
  );

  return {
    sample,
    rows: sample.active ? SAMPLE_AGENT_ROWS : (agents.data ?? []),
    // Suppress loading/error under sample mode. Use `!orgId` not `!!orgId` to avoid false
    // "no agents registered" before org resolves.
    isLoading: !sample.active && (!orgId || agents.isLoading),
    error: sample.active ? null : agents.error,
  };
}

// Asynchronous: mutation returns when request recorded, answer through next read. hasAsked
// per mount; second request dropped if first in flight.
function useAgentSync({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const [hasAsked, setAsked] = useState(false);
  const toaster = useGovernanceToaster();
  const showErrorToast = useShowErrorToast();
  const sources = api.governanceAgents.syncSources.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId, refetchOnWindowFocus: false },
  );
  const mutation = api.governanceAgents.requestListing.useMutation({
    onSuccess: (result) => {
      // Zero is not an ask: the service only asks sources the scheduler
      // will pull, so a connected provider can still leave this at zero.
      // Latching `hasAsked` here would tell the reader to reload for an
      // answer that will never come, and "Asked 0 providers" would read as miscounting.
      if (result.requested === 0) {
        toaster.create({
          title: "Nothing to ask",
          description: "No connected provider is scheduled to be asked right now.",
          type: "info",
        });
        return;
      }
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
    onError: (error) => showErrorToast({ error, fallbackTitle: "Couldn't request a sync" }),
  });

  const connected = sources.data ?? [];
  const status = governanceSyncStatus({
    canManage,
    // Same window as the agents read above: until the organization resolves
    // this query is disabled and reports `isLoading: false`, so `connected`
    // is empty and the control would say "no provider can list agents" about
    // an organization it has not identified yet.
    isLoadingSources: !orgId || sources.isLoading,
    sourceCount: connected.length,
    isAsking: mutation.isPending,
    hasAsked,
  });
  const unavailableReason =
    status.state === "unavailable" ? AGENT_SYNC_UNAVAILABLE_REASONS[status.because] : null;

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
        : unavailableReason,
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

// Filter row in header, not here (same as api keys page).
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
   * What to show when the organization holds no agents, decided by the page
   * (a read this pane doesn't make). Words and press travel together so a
   * state can't arrive with the wrong page's action attached.
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
        {/*
         * Named, so a screen reader announces a wait rather than nothing at
         * all — and so a test can assert the wait is what rendered. Without a
         * name this branch is indistinguishable from an empty pane to both.
         */}
        <Spinner aria-label="Loading agents" />
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

// Reads page state to decide empty pane: no provider, nothing asked, every answered (only
// "org has none"), or refusal (beats other readings). Copy in emptyStates.ts.
// Higher rank = more actionable refusal cause (access > unreachable > incomplete).
const REFUSAL_CAUSE_RANK: Record<AgentsListingRefusalCause, number> = {
  // Somebody has to fix something; asking again changes nothing until then.
  access: 3,
  // Asking again later is the whole remedy.
  unreachable: 2,
  // Nothing is wrong and asking again walks the same pages to the same bound.
  incomplete: 1,
};

/** `causes` is never empty here: the caller only asks once a refusal exists. */
function mostActionableCause(
  causes: readonly AgentsListingRefusalCause[],
): AgentsListingRefusalCause {
  return causes.reduce((best, cause) =>
    REFUSAL_CAUSE_RANK[cause] > REFUSAL_CAUSE_RANK[best] ? cause : best,
  );
}

function chooseNoAgentsState({
  connected,
  canAsk,
  onRegister,
  onSync,
  syncDisabled,
}: {
  connected: readonly {
    name: string;
    lastListing: AgentsListingOutcome | null;
  }[];
  canAsk: boolean;
  onRegister: () => void;
  onSync: () => void;
  syncDisabled: boolean;
}) {
  if (connected.length === 0) {
    return {
      copy: AGENTS_EMPTY_COPY,
      onAct: onRegister,
      actionDisabled: false,
      testId: "agents-empty",
    };
  }

  const refused = connected.filter((source) => source.lastListing?.outcome === "refused");
  if (refused.length > 0) {
    return {
      copy: agentsRefusedCopy({
        // Only the ones that refused. Naming a provider that answered would
        // blame it for a fault it does not have, and send its owner to audit a
        // credential that is working.
        providerNames: refused.map((source) => source.name),
        cause: mostActionableCause(
          refused.flatMap((source) =>
            source.lastListing?.outcome === "refused" ? [source.lastListing.cause] : [],
          ),
        ),
        canAsk,
      }),
      onAct: onSync,
      actionDisabled: syncDisabled,
      testId: "agents-empty-refused",
    };
  }

  if (connected.every((source) => source.lastListing?.outcome === "listed")) {
    return {
      copy: agentsListedEmptyCopy({
        providerNames: connected.map((source) => source.name),
      }),
      onAct: onRegister,
      actionDisabled: false,
      testId: "agents-empty-listed",
    };
  }

  return {
    copy: agentsUnlistedCopy({
      providerNames: connected.map((source) => source.name),
      canAsk,
    }),
    onAct: onSync,
    actionDisabled: syncDisabled,
    testId: "agents-empty-unlisted",
  };
}

function AgentsPage() {
  const { layout, selectLayout } = useAgentsLayout();
  const { openDrawer } = useDrawer();
  const openRegister = () => openDrawer("addAgent");
  useAddAgentDeepLink();
  const { organization, hasAnyPermission } = useGovernanceScope();
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
  const noAgents = chooseNoAgentsState({
    connected: sync.connected,
    // The sentence follows the grant, not the momentary state of the button:
    // "asking" and "asked" are both readers who may ask.
    canAsk: canManage,
    onRegister: openRegister,
    onSync: sync.press,
    syncDisabled: sync.state !== "ready",
  });

  return (
    <GovernanceLayout pageTitle="Agents · AI Governance · LangWatch">
      <VStack align="stretch" gap={5} width="full" maxW="container.xl">
        <HStack justify="space-between" align="center">
          <Heading size="md">Agents</Heading>
          <HStack gap={2}>
            {/* Same corner and same order as the inventory's header: how the
                content is drawn, then whether it is invented, then the one
                thing this page is for adding. */}
            {showControls && <AgentsLayoutControl layout={layout} onChange={selectLayout} />}
            {/* Ghost, so the one outlined control in this row stays the
                action that creates something of the organization's own — the
                same arrangement as `Run match pass`. Rendered for every
                reader, not gated on the manage grant, so a reader who can't
                press it still sees why the page won't refresh. */}
            <GovernanceSyncButton
              label="Sync agents"
              state={sync.state}
              reason={sync.reason}
              onPress={sync.press}
            />
            <SampleDataToggle active={sample.active} onToggle={sample.toggle} size="sm" />
            {/* The action that creates this page's own thing, drawn as the
                house header button — outline, small, leading plus glyph,
                the same control /settings/model-providers uses for "Add
                Model Provider". The brand accent marks only the sample
                affordances, the one thing on this screen it must distinguish.
                Rule: specs/ai-governance/dashboard/governance-ui-controls.feature */}
            <PageLayout.HeaderButton onClick={openRegister}>
              <Plus size={14} />
              Register agent
            </PageLayout.HeaderButton>
          </HStack>
        </HStack>
        {sample.active && (
          <SampleDataBanner>
            These agents are an illustration of what this page will hold, nothing here is real.
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

export default AgentsPage;
