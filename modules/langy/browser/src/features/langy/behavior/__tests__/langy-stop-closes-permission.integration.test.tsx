/**
 * @vitest-environment jsdom
 *
 * The stop's own answer closes the stopped turn's permission card, since Stop aborted the stream.
 * @see specs/langy/langy-stop-and-resume.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stopAnswer: { resolve: () => void } = { resolve: () => undefined };
/** The messages refetch the stop asks for; it brings back nothing that closes the card. */
const invalidateMessages = vi.fn(async () => undefined);

vi.mock("../../../../behavior/langy-api.ts", () => ({
  api: {
    useUtils: () => ({ langy: { messages: { invalidate: invalidateMessages } } }),
    langy: {
      stopTurn: {
        useMutation: () => ({
          mutateAsync: () =>
            new Promise<{ stopped: boolean }>((resolve) => {
              stopAnswer.resolve = () => resolve({ stopped: true });
            }),
        }),
      },
      answerLocalPermission: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      setLocalPolicy: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
  },
}));

const { useLangyStore } = await import("../../../../behavior/langy.store.ts");
const { useLangyLocalControlStore } =
  await import("../../../../behavior/langy-local-control.store.ts");
const { langyPermissionCards } = await import("../../../../model/langy-local-waits.ts");
const { useLangyPanelStop } = await import("../panel/use-langy-panel-stop.ts");
const { LangyLocalPermissionCard } =
  await import("../../ui/sections/langy-local-permission-card.tsx");

/** The live wait a worker command put up, as the transport records it: tied to the tool call. */
function recordLivePermission({ turnId, toolCallId }: { turnId: string; toolCallId?: string }) {
  const id = toolCallId ?? "no-call";
  useLangyLocalControlStore.getState().recordWait({
    conversationId: "conv-1",
    wait: {
      waitId: `wait-${id}`,
      kind: "permission",
      status: "pending",
      toolCallId,
      turnId,
      callId: `local-${id}`,
      summary: "pnpm typecheck",
      pattern: "pnpm *",
      patterns: ["pnpm *"],
      reason: "Runs the project's own type check",
      skipOffered: false,
      workspaceName: "acme-app",
      hostname: "dev-laptop",
    },
  });
}

/** The panel's own derivation: the permission cards off this tab's live entries. */
function LivePermissionCards() {
  const live = useLangyLocalControlStore((s) => s.waits);
  return (
    <>
      {langyPermissionCards({ live }).map((card) => (
        <LangyLocalPermissionCard
          key={card.waitId}
          projectId="proj-1"
          conversationId="conv-1"
          card={card}
          skipAllowed={false}
          skipPermissions={false}
        />
      ))}
    </>
  );
}

function renderLive() {
  return render(
    <DesignSystemProvider forcedTheme="light">
      <LivePermissionCards />
    </DesignSystemProvider>,
  );
}

function isAnswerable(): boolean {
  return screen.queryByRole("button", { name: "Allow once" }) !== null;
}

async function answerStop(): Promise<void> {
  await act(async () => {
    stopAnswer.resolve();
    await Promise.resolve();
  });
}

describe("a live permission card when Stop is answered", () => {
  beforeEach(() => {
    invalidateMessages.mockClear();
    useLangyStore.getState().resetForScope({});
    useLangyLocalControlStore.getState().reset("conv-1");
    const store = useLangyStore.getState();
    store.selectConversation("conv-1");
    store.beginTurn({ conversationId: "conv-1", turnId: "turn-1" });
  });
  afterEach(() => {
    cleanup();
    useLangyStore.getState().resetForScope({});
    useLangyLocalControlStore.getState().reset(null);
  });

  describe("given the stopped turn's command still waits for permission", () => {
    describe("when no stream entry and no refetch reaches the tab after the stop", () => {
      /** @scenario The permission card closes as soon as Stop is answered, without a reload */
      it("takes the answers off the card", async () => {
        recordLivePermission({ turnId: "turn-1", toolCallId: "call-b1" });
        renderLive();
        const { result } = renderHook(() =>
          useLangyPanelStop({
            projectId: "proj-1",
            foldInFlightTurnId: null,
            stop: async () => {},
          }),
        );
        expect(isAnswerable()).toBe(true);

        act(() => result.current());
        await answerStop();

        expect(invalidateMessages).toHaveBeenCalled();
        expect(isAnswerable()).toBe(false);
        expect(screen.getByText("Cancelled with the turn")).toBeDefined();
      });
    });

    describe("when the permission carries no tool call id", () => {
      it("still takes the answers off the card: a permission is no confirmation", async () => {
        recordLivePermission({ turnId: "turn-1" });
        renderLive();
        const { result } = renderHook(() =>
          useLangyPanelStop({
            projectId: "proj-1",
            foldInFlightTurnId: null,
            stop: async () => {},
          }),
        );
        expect(isAnswerable()).toBe(true);

        act(() => result.current());
        await answerStop();

        expect(isAnswerable()).toBe(false);
      });
    });
  });
});
