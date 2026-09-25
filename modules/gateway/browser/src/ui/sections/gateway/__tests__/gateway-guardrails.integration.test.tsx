/**
 * @vitest-environment jsdom
 * Characterizes the guardrails list: project gate, empty states and the bound guardrails.
 */
import { cleanup, screen } from "@testing-library/react";
import type React from "react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeGatewayHost, renderWithGatewayHost } from "../../../../testing.tsx";

vi.mock("../../../../ui/sections/gateway-layout.tsx", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

const state = vi.hoisted(() => ({
  guardrails: [] as unknown[],
  monitors: [] as unknown[],
}));

vi.mock("../../../../behavior/gateway-api.ts", () => {
  const data: Record<string, () => unknown> = {
    "gatewayGuardrails.list": () => state.guardrails,
    "monitors.getAllForProject": () => state.monitors,
  };
  const node = (path: string[]): unknown =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (typeof property !== "string") return undefined;
          if (property === "useQuery") {
            const read = data[path.join(".")];
            return () => ({
              data: read ? read() : undefined,
              isLoading: false,
              isError: false,
              error: null,
              refetch: vi.fn(),
            });
          }
          if (property === "useMutation") {
            return () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
          }
          if (property === "invalidate") return vi.fn();
          if (property === "useUtils") return () => node([]);
          return node([...path, property]);
        },
      },
    );

  return { api: node([]) };
});

import GuardrailsPage from "../gateway-guardrails.screen.tsx";

const MONITOR = {
  enabled: true,
  executionMode: "AS_GUARDRAIL",
  evaluatorId: "ev-1",
  name: "PII check",
  slug: "pii-check",
};

function guardrail(overrides: Record<string, unknown>) {
  return {
    id: "gr-1",
    name: "Block PII",
    description: "No personal data",
    evaluatorId: "ev-1",
    direction: "PRE",
    failureMode: "FAIL_CLOSED",
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const PROJECT = { id: "proj-1", name: "web-app", slug: "web-app", teamId: "team-1" };

function renderPage(input: { permissions?: readonly string[]; withProject?: boolean } = {}) {
  return renderWithGatewayHost(<GuardrailsPage />, {
    host: fakeGatewayHost({
      permissions: input.permissions ?? ["gatewayGuardrails:manage"],
      project: input.withProject === false ? null : PROJECT,
    }),
  });
}

beforeEach(() => {
  state.guardrails = [];
  state.monitors = [MONITOR];
});
afterEach(() => cleanup());

describe("guardrails page", () => {
  describe("when no project is in scope", () => {
    it("asks for a project first", () => {
      renderPage({ withProject: false });

      expect(screen.getByText("Pick a project first")).toBeInTheDocument();
    });
  });

  describe("when there are no guardrails", () => {
    it("invites binding an evaluator when guardrail evaluators exist", () => {
      renderPage();

      expect(screen.getByText("No guardrails yet")).toBeInTheDocument();
      expect(screen.getByText(/to bind one of your project/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /New guardrail/ })).toBeEnabled();
    });

    it("explains the executionMode switch when no evaluator is a guardrail", () => {
      state.monitors = [{ ...MONITOR, executionMode: "ON_MESSAGE" }];
      renderPage();

      expect(
        screen.getByText(/No project evaluators are marked as guardrails/),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /New guardrail/ })).toBeDisabled();
    });

    it("lists no archived guardrail", () => {
      state.guardrails = [guardrail({ archivedAt: "2026-02-01T00:00:00Z" })];
      renderPage();

      expect(screen.getByText("No guardrails yet")).toBeInTheDocument();
    });
  });

  describe("when guardrails are bound", () => {
    it("shows each with its direction, evaluator and failure mode", () => {
      state.guardrails = [
        guardrail({}),
        guardrail({
          id: "gr-2",
          name: "Tone",
          description: null,
          evaluatorId: "ev-gone",
          direction: "POST",
          failureMode: "FAIL_OPEN",
        }),
      ];
      renderPage();

      expect(screen.getByText("Block PII")).toBeInTheDocument();
      expect(screen.getByText("No personal data")).toBeInTheDocument();
      expect(screen.getByText("Pre (request)")).toBeInTheDocument();
      expect(screen.getByText("PII check")).toBeInTheDocument();
      expect(screen.getByText("pii-check")).toBeInTheDocument();
      expect(screen.getByText("fail closed")).toBeInTheDocument();
      expect(screen.getByText("Post (response)")).toBeInTheDocument();
      expect(screen.getByText("ev-gone")).toBeInTheDocument();
      expect(screen.getByText("fail open")).toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: /Edit/ })).toHaveLength(2);
    });

    it("offers no authoring controls without the manage grant", () => {
      state.guardrails = [guardrail({})];
      renderPage({ permissions: [] });

      expect(screen.getByText("Block PII")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Edit/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /New guardrail/ })).not.toBeInTheDocument();
    });
  });
});
