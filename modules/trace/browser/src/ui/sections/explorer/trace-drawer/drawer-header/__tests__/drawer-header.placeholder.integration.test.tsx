// @vitest-environment jsdom
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const mocks = vi.hoisted(() => ({
  openDrawer: vi.fn(),
  closeDrawer: vi.fn(),
}));

vi.mock("../../../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1", slug: "acme" },
    hasPermission: () => true,
  }),
}));

vi.mock("@langwatch/browser-host/use-drawer", () => ({
  useDrawer: () => ({
    openDrawer: mocks.openDrawer,
    closeDrawer: mocks.closeDrawer,
  }),
}));

vi.mock("../../../../use-deja-view-link.ts", () => ({
  useDejaViewLink: () => ({ href: null }),
}));

vi.mock("../../../../me/use-personal-feature-gate.ts", () => ({
  usePersonalFeatureGate: () => ({
    isGated: false,
    requestEnable: async () => true,
    dialogState: {
      open: false,
      feature: "annotations",
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
      isEnabling: false,
    },
  }),
}));

vi.mock("../../../../../elements/presence/trace-presence-avatars.tsx", () => ({
  TracePresenceAvatars: () => null,
}));
// `ModeSwitch` and `VizPlaceholder` read the peer store to decide whose
// cursors to show. The header renders both, so the mock has to answer for
// the store as well or the module throws before anything is asserted.
vi.mock("../../../../../../behavior/presence/presence-store.ts", () => ({
  usePresenceStore: () => [],
  selectPeersMatching: () => () => [],
}));

vi.mock("../../../hooks/use-trace-resources.ts", () => ({
  useTraceResources: () => ({
    resourceAttributes: {},
    scopeName: null,
    scopeVersion: null,
    bySpan: new Map(),
    isLoading: false,
  }),
}));

vi.mock("../../../hooks/use-conversation-context.ts", () => ({
  useConversationContext: () => ({
    turns: [],
    position: null,
    total: 0,
    previous: null,
    next: null,
    isLoading: false,
  }),
}));

vi.mock("../../../hooks/use-trace-refresh.ts", () => ({
  useTraceRefresh: () => ({ refresh: vi.fn(), isRefreshing: false }),
}));

vi.mock("../../../hooks/use-trace-drawer-navigation.ts", () => ({
  useTraceDrawerNavigation: () => ({
    canGoBack: false,
    goBack: vi.fn(),
    goBackTo: vi.fn(),
    backStackDepth: 0,
    backStack: [],
  }),
}));

vi.mock("../../../hooks/use-span-tree.ts", () => ({
  useSpanTree: () => ({ data: [], isLoading: false }),
}));

vi.mock("../../trace-header-chips.tsx", () => ({
  useTraceHeaderChipDefs: () => [],
}));

vi.mock("../../../add-to-annotation-queue-dialog.tsx", () => ({
  AddToAnnotationQueueDialog: () => null,
}));

vi.mock("../share-trace-dialog.tsx", () => ({ ShareTraceDialog: () => null }));

// `EditableTraceName` moved into `@langwatch/trace-browser`, where it runs a real
// tRPC mutation and would need a transport Provider this test has no reason to
// mount. Partially mock the barrel so everything else it exports — notably
// `usePinnedAttributesStore`, which this test drives — stays real.
vi.mock("../../../../editable-trace-name.tsx", () => ({
  EditableTraceName: ({ value }: { value: string }) => <span>{value}</span>,
}));

vi.mock("../trace-overflow-menu.tsx", () => ({ TraceOverflowMenu: () => null }));

vi.mock("../../edit-mode/edited-original-toggle.tsx", () => ({
  EditedOriginalToggle: () => null,
}));

vi.mock("../../raw-json-dialog.tsx", () => ({ RawJsonDialog: () => null }));

import { traceHeaderSchema, type TraceHeader } from "@langwatch/trace-contract";

import { usePinnedAttributesStore } from "../../../../../../behavior/pinned-attributes.store.ts";
import { DrawerHeader } from "../drawer-header.tsx";

function makeTrace(overrides: Partial<TraceHeader> = {}): TraceHeader {
  return traceHeaderSchema.parse({
    traceId: "trace-1",
    timestamp: 1_700_000_000_000,
    name: "root",
    serviceName: "svc",
    origin: "sdk",
    conversationId: null,
    userId: null,
    durationMs: 120,
    spanCount: 3,
    status: "ok",
    error: null,
    input: null,
    output: null,
    models: ["openai/gpt-5-mini", "anthropic/claude-sonnet"],
    totalCost: 0,
    nonBilledCost: 0,
    totalTokens: 0,
    inputTokens: null,
    outputTokens: null,
    tokensEstimated: false,
    ttft: null,
    traceName: "root",
    rootSpanType: null,
    scenarioRunId: null,
    containsPrompt: false,
    selectedPromptId: null,
    selectedPromptSpanId: null,
    lastUsedPromptId: null,
    lastUsedPromptVersionNumber: null,
    lastUsedPromptVersionId: null,
    lastUsedPromptSpanId: null,
    attributes: {
      "metadata.model": "openai/gpt-5-mini",
      "metadata.models": '["openai/gpt-5-mini","anthropic/claude-sonnet"]',
      "metadata.environment": "production",
    },
    ...overrides,
  });
}

function renderHeader(trace: TraceHeader = makeTrace()) {
  return renderWithDesignSystem(
    <MemoryRouter>
      <DrawerHeader trace={trace} isPlaceholder onClose={vi.fn()} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  usePinnedAttributesStore.setState({ byProject: {} });
});

afterEach(cleanup);

describe("given a list-row placeholder trace", () => {
  it("shows the metrics the list row already knows and a skeleton for the rest", () => {
    renderHeader();

    expect(screen.getByText("Duration")).toBeInTheDocument();
    expect(screen.getByTestId("trace-header-metric-skeleton")).toBeInTheDocument();
  });
});
