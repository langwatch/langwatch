/**
 * @vitest-environment jsdom
 * URL-routed drawer; the guardrail editor rebuilds from the guardrail id in the address.
 */
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeGatewayHost, renderWithGatewayHost } from "../../../../testing.tsx";

const state = vi.hoisted(() => ({
  guardrails: [] as unknown[],
  monitors: [] as unknown[],
  mutate: vi.fn(),
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
            return () => ({ mutate: state.mutate, mutateAsync: vi.fn(), isPending: false });
          }
          if (property === "invalidate") return vi.fn();
          if (property === "useUtils") return () => node([]);
          return node([...path, property]);
        },
      },
    );

  return { api: node([]) };
});

import { GuardrailDrawer } from "../gateway-guardrails.screen.tsx";

const PROJECT = { id: "proj-1", name: "web-app", slug: "web-app", teamId: "team-1" };

/** The drawer with the props the registry's adapter reads off `?drawer.guardrailId=`. */
function renderDrawer(guardrailId?: string) {
  return renderWithGatewayHost(<GuardrailDrawer guardrailId={guardrailId} onClose={vi.fn()} />, {
    host: fakeGatewayHost({ permissions: ["gatewayGuardrails:manage"], project: PROJECT }),
  });
}

describe("given a shared link that carries a guardrail", () => {
  beforeEach(() => {
    state.guardrails = [
      {
        id: "gr-1",
        name: "Block PII",
        description: "No personal data",
        evaluatorId: "ev-1",
        direction: "PRE",
        failureMode: "FAIL_CLOSED",
        archivedAt: null,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ];
    state.monitors = [
      {
        enabled: true,
        executionMode: "AS_GUARDRAIL",
        evaluatorId: "ev-1",
        name: "PII check",
        slug: "pii-check",
      },
    ];
  });
  afterEach(cleanup);

  it("rebuilds the editor for that guardrail from the address alone", async () => {
    renderDrawer("gr-1");

    expect(await screen.findByText("Edit guardrail")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId("gateway-guardrail-name")).toHaveValue("Block PII");
    });
  });

  it("opens the new-guardrail form when the address carries no id", async () => {
    renderDrawer();

    expect(await screen.findByText("New guardrail")).toBeInTheDocument();
    expect(screen.getByTestId("gateway-guardrail-name")).toHaveValue("");
  });
});

describe("given the guardrail form is saved incomplete", () => {
  beforeEach(() => {
    state.mutate.mockClear();
    state.guardrails = [];
    state.monitors = [];
  });
  afterEach(cleanup);

  /** @scenario Saving an incomplete guardrail names the missing name and evaluator */
  it("explains the missing name and evaluator, focuses the first and sends nothing", async () => {
    const user = userEvent.setup();
    renderDrawer();

    expect(screen.queryByText("Enter a name.")).not.toBeInTheDocument();
    await user.click(await screen.findByTestId("gateway-guardrail-submit"));

    expect(screen.getByText("Enter a name.")).toBeInTheDocument();
    expect(screen.getByText("Choose an evaluator.")).toBeInTheDocument();
    expect(screen.getByTestId("gateway-guardrail-name")).toHaveFocus();

    await user.type(screen.getByTestId("gateway-guardrail-name"), "Block PII");
    await user.click(screen.getByTestId("gateway-guardrail-submit"));
    expect(screen.queryByText("Enter a name.")).not.toBeInTheDocument();
    expect(screen.getByTestId("gateway-guardrail-evaluator")).toHaveFocus();
    expect(state.mutate).not.toHaveBeenCalled();
  });

  /** @scenario An edit whose guardrail is no longer available offers no save */
  it("offers no save for an edit whose guardrail is not there", async () => {
    renderDrawer("gr-missing");

    expect(await screen.findByText("This guardrail is no longer available")).toBeInTheDocument();
    expect(screen.queryByTestId("gateway-guardrail-submit")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });
});
