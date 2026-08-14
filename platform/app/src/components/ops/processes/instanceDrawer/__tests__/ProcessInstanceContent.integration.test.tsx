/**
 * @vitest-environment jsdom
 *
 * Renders the real drawer body via React Testing Library against an actual
 * ChakraProvider — the queries stay outside, plain data comes in.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ProcessInstanceDetail } from "~/server/app-layer/ops/manager-explorer.service";
import type { ProcessOutboxMessageView } from "~/server/app-layer/ops/repositories/process-ops.repository";
import { OutboxMessageCard } from "../OutboxMessageCard";
import { ProcessInstanceContent } from "../ProcessInstanceContent";

const NOW = 1_755_100_000_000;

const DETAIL: ProcessInstanceDetail = {
  ref: {
    processName: "automations",
    projectId: "project_LVYcVYGW1AJqvp2G8vcVd",
    processKey: "rule_42",
  },
  tenantId: "project_LVYcVYGW1AJqvp2G8vcVd",
  state: { phase: "waiting", armedRuleId: "rule_42" },
  revision: 17,
  nextWakeAt: NOW + 4 * 60 * 1000,
  updatedAt: NOW - 30_000,
};

function makeMessage(
  overrides: Partial<ProcessOutboxMessageView> = {},
): ProcessOutboxMessageView {
  return {
    id: "msg-1",
    messageKey: "dispatch:turn_9:1",
    intentType: "automation.execute",
    status: "pending",
    attempts: 2,
    nextAttemptAt: NOW + 10_000,
    leasedUntil: null,
    createdAt: NOW - 60_000,
    sourceEventId: "evt_1",
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    payload: { ruleId: "rule_42" },
    ...overrides,
  };
}

const withChakra = (node: React.ReactElement) =>
  render(<ChakraProvider value={defaultSystem}>{node}</ChakraProvider>);

afterEach(cleanup);

describe("ProcessInstanceContent", () => {
  describe("when the drawer renders an instance", () => {
    /** @scenario "An instance drawer answers what the process is doing" */
    it("shows the state as JSON with revision and next wake, and the outbox with a trace link", () => {
      const { container } = withChakra(
        <ProcessInstanceContent
          detail={DETAIL}
          isLoading={false}
          outbox={{ messages: [makeMessage()], total: 1 }}
          outboxLoading={false}
          grafana={{ baseUrl: "https://observability.langwatch.localhost" }}
          now={NOW}
        />,
      );
      expect(container.textContent).toContain("Revision");
      expect(container.textContent).toContain("17");
      expect(container.textContent).toContain("in 4m");
      expect(container.textContent).toContain("armedRuleId");
      expect(container.textContent).toContain("automation.execute");
      expect(container.textContent).toContain("2 attempts");
      const traceLink = screen.getByText(/producing trace/);
      expect(traceLink.closest("a")?.getAttribute("href")).toContain(
        "/explore",
      );
    });
  });

  describe("when the instance does not exist", () => {
    it("says so instead of rendering an empty body", () => {
      withChakra(
        <ProcessInstanceContent
          detail={null}
          isLoading={false}
          outbox={null}
          outboxLoading={false}
          now={NOW}
        />,
      );
      expect(
        screen.getByTestId("process-instance-missing").textContent,
      ).toContain("no longer exists");
    });
  });
});

describe("OutboxMessageCard", () => {
  describe("given a pending message whose lease expired", () => {
    /** @scenario "A lapsed lease does not accuse a live dispatcher" */
    it("reads as dispatcher died or still delivering", () => {
      const { container } = withChakra(
        <OutboxMessageCard
          message={makeMessage({ leasedUntil: NOW - 5_000 })}
          now={NOW}
          canManage={false}
        />,
      );
      expect(container.textContent).toContain(
        "dispatcher died or still delivering",
      );
      expect(container.textContent).not.toMatch(/dispatcher died(?! or)/);
    });
  });

  describe("given a dead message and manage access", () => {
    it("offers a redrive", () => {
      withChakra(
        <OutboxMessageCard
          message={makeMessage({ status: "dead" })}
          now={NOW}
          canManage={true}
          onRedrive={() => undefined}
        />,
      );
      expect(screen.getByRole("button", { name: "Redrive" })).toBeTruthy();
    });
  });

  describe("given a lapsed lease and manage access", () => {
    it("offers the release with its risk in the tooltip", () => {
      withChakra(
        <OutboxMessageCard
          message={makeMessage({ leasedUntil: NOW - 5_000 })}
          now={NOW}
          canManage={true}
          onReleaseLease={() => undefined}
        />,
      );
      const button = screen.getByRole("button", { name: "Release lease" });
      expect(button.getAttribute("title")).toContain("re-delivers");
    });
  });
});
