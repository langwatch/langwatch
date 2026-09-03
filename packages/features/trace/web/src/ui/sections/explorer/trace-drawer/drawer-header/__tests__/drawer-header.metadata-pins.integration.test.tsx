/**
 * @vitest-environment jsdom
 *
 * What the metadata auto-pin sweep promotes onto the pinned-context strip. The
 * models a trace used are already stated by the metrics row one line above, so
 * the sweep leaves those keys alone, while a key the reviewer pinned by hand is
 * still theirs. See specs/traces-v2/drawer-header-model-pins.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const mocks = vi.hoisted(() => ({
  openDrawer: vi.fn(),
  closeDrawer: vi.fn(),
}));

vi.mock("../../../../../../behavior/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1", slug: "acme" },
    hasPermission: () => true,
  }),
}));

vi.mock("../../../../../../behavior/use-drawer", () => ({
  useDrawer: () => ({
    openDrawer: mocks.openDrawer,
    closeDrawer: mocks.closeDrawer,
  }),
}));

vi.mock("../../../../use-deja-view-link", () => ({
  useDejaViewLink: () => ({ href: null }),
}));

vi.mock("../../../../me/use-personal-feature-gate", () => ({
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

vi.mock("@langwatch/presence-web", () => ({
  TracePresenceAvatars: () => null,
  // `ModeSwitch` and `VizPlaceholder` read the peer store to decide whose
  // cursors to show. The header renders both, so the mock has to answer for
  // the store as well or the module throws before anything is asserted.
  usePresenceStore: () => [],
  selectPeersMatching: () => () => [],
}));

vi.mock("../../../hooks/use-trace-resources", () => ({
  useTraceResources: () => ({
    resourceAttributes: {},
    scopeName: null,
    scopeVersion: null,
    bySpan: new Map(),
    isLoading: false,
  }),
}));

vi.mock("../../../hooks/use-conversation-context", () => ({
  useConversationContext: () => ({
    turns: [],
    position: null,
    total: 0,
    previous: null,
    next: null,
    isLoading: false,
  }),
}));

vi.mock("../../../hooks/use-trace-refresh", () => ({
  useTraceRefresh: () => ({ refresh: vi.fn(), isRefreshing: false }),
}));

vi.mock("../../../hooks/use-trace-drawer-navigation", () => ({
  useTraceDrawerNavigation: () => ({
    canGoBack: false,
    goBack: vi.fn(),
    goBackTo: vi.fn(),
    backStackDepth: 0,
    backStack: [],
  }),
}));

vi.mock("../../../hooks/use-span-tree", () => ({
  useSpanTree: () => ({ data: [], isLoading: false }),
}));

vi.mock("../../trace-header-chips", () => ({
  useTraceHeaderChipDefs: () => [],
}));

vi.mock("../../../add-to-annotation-queue-dialog", () => ({
  AddToAnnotationQueueDialog: () => null,
}));

vi.mock("../share-trace-dialog", () => ({ ShareTraceDialog: () => null }));

// `EditableTraceName` moved into `@langwatch/trace-web`, where it runs a real
// tRPC mutation and would need a transport Provider this test has no reason to
// mount. Partially mock the barrel so everything else it exports — notably
// `usePinnedAttributesStore`, which this test drives — stays real.
vi.mock("../../../../../../index", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../../../index")>()),
  EditableTraceName: ({ value }: { value: string }) => <span>{value}</span>,
}));

vi.mock("../trace-overflow-menu", () => ({ TraceOverflowMenu: () => null }));

vi.mock("../../edit-mode/edited-original-toggle", () => ({
  EditedOriginalToggle: () => null,
}));

vi.mock("../../raw-json-dialog", () => ({ RawJsonDialog: () => null }));

import type { TraceHeader } from "@langwatch/trace-contract";
import { usePinnedAttributesStore } from "../../../../../../index";
import { DrawerHeader } from "../drawer-header";

function makeTrace(overrides: Partial<TraceHeader> = {}): TraceHeader {
  return {
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
  } as TraceHeader;
}

function renderHeader(trace: TraceHeader = makeTrace()) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <DrawerHeader trace={trace} onClose={vi.fn()} />
    </ChakraProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  usePinnedAttributesStore.setState({ byProject: {} });
});

afterEach(cleanup);

describe("given a trace whose metadata repeats the models it used", () => {
  /** @scenario "The model metadata keys are not auto-pinned under the Model pill" */
  it("auto-pins the other metadata keys but neither model key", () => {
    renderHeader();

    expect(screen.getByLabelText("Copy metadata.environment")).toBeVisible();
    expect(screen.queryByLabelText("Copy metadata.model")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Copy metadata.models")).not.toBeInTheDocument();
  });

  /** @scenario "The model metadata keys are not auto-pinned under the Model pill" */
  it("still states the models on the metrics row", () => {
    renderHeader();

    expect(screen.getByText("Models")).toBeVisible();
  });
});

describe("given a reviewer who pinned the model metadata key themselves", () => {
  beforeEach(() => {
    // Through the store's own action, so the pin survives the hydrate-from
    // -storage pass the strip runs on mount.
    usePinnedAttributesStore.getState().togglePin("project-1", {
      source: "attribute",
      key: "metadata.model",
      label: "model",
    });
  });

  /** @scenario "A reviewer who pinned the model key keeps their own pin" */
  it("renders their pin, with the unpin affordance a pin they made carries", () => {
    renderHeader();

    expect(screen.getByLabelText("Copy metadata.model")).toBeVisible();
    expect(screen.getByLabelText("Unpin metadata.model")).toBeVisible();
  });
});
