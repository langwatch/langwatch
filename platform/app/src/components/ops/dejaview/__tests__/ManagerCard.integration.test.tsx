/**
 * @vitest-environment jsdom
 *
 * The process-manager card is DejaView's "state machine for a single aggregate":
 * the machine's triggers and emitted commands, plus this aggregate's current
 * position (state, revision) and the commands it has sent.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { AggregateProcessManager } from "~/server/app-layer/ops/manager-explorer.service";

import { ManagerCard } from "../ManagerCard";

const running: AggregateProcessManager = {
  processName: "langyConversation",
  pipelineName: "langy-conversation-processing",
  eventTypes: ["langy.turn.started"],
  intentTypes: ["dispatchTurn"],
  hasWake: false,
  instance: {
    state: { turnStatus: "running" },
    revision: 2,
    nextWakeAt: null,
    updatedAt: 1_700_000_000_000,
  },
  outbox: [
    {
      messageKey: "k1",
      intentType: "dispatchTurn",
      status: "pending",
      attempts: 0,
      nextAttemptAt: 0,
      createdAt: 1_700_000_000_000,
      sourceEventId: "e1",
    },
  ],
};

const renderCard = (manager: AggregateProcessManager) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <ManagerCard manager={manager} />
    </ChakraProvider>,
  );

afterEach(cleanup);

describe("ManagerCard", () => {
  describe("given a machine running for the aggregate", () => {
    describe("when the card renders", () => {
      it("names the machine and marks it active", () => {
        renderCard(running);
        expect(screen.getByText("langyConversation")).toBeDefined();
        expect(screen.getByText("Active")).toBeDefined();
      });

      it("shows the trigger event types and the current state", () => {
        renderCard(running);
        expect(screen.getByText("langy.turn.started")).toBeDefined();
        expect(screen.getByText("State")).toBeDefined();
        expect(screen.getAllByText(/running/).length).toBeGreaterThan(0);
      });

      it("lists the commands the machine has emitted", () => {
        renderCard(running);
        expect(screen.getByText("Emitted commands")).toBeDefined();
        expect(screen.getByText("pending")).toBeDefined();
      });
    });
  });

  describe("given a machine that has not started for the aggregate", () => {
    describe("when the card renders", () => {
      it("says so instead of showing empty state", () => {
        renderCard({ ...running, instance: null, outbox: [] });
        expect(screen.getByText("Not started")).toBeDefined();
        expect(
          screen.getByText("This machine has not started for this aggregate."),
        ).toBeDefined();
      });
    });
  });
});
