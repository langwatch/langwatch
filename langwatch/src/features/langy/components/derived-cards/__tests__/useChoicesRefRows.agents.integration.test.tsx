/**
 * @vitest-environment jsdom
 *
 * Agent refs on a choices card, resolved as the viewer.
 *
 * `AGENTS.md` teaches the choices block using an agent ref by example — "which
 * agent should this scenario run against?" is the question ADR-060 exists for —
 * so an agent ref is the one the model is most likely to emit. It was also the
 * one kind `CAPABILITY_HYDRATORS` could not resolve, which meant the row fell
 * through to `plain`: the raw id instead of a name, and an agent that no longer
 * exists still offered as a live choice.
 *
 * Spec: specs/langy/langy-choice-questions.feature — "live rows", and
 * "A dead reference cannot be selected".
 *
 * Boundary mocks only: the project context and the tRPC surface. The hook, the
 * hydrator registry and the agent hydrator are all real.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const PROJECT_ID = "project-demo";

interface FakeAgent {
  id: string;
  name: string;
  type: string;
}

/** What `agents.getAll` answers — archived agents are already excluded by it. */
const agents: { current: FakeAgent[] } = { current: [] };
const getAllFetch = vi.fn();

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: PROJECT_ID } }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
      agents: { getAll: { fetch: getAllFetch } },
    }),
  },
}));

import { useChoicesRefRows } from "../useChoicesRefRows";

const askWhichAgent = (refId: string) => [
  {
    id: "option-1",
    label: "the one the model named",
    ref: { type: "agent" as const, id: refId },
  },
];

describe("a choices card asking which agent to run against", () => {
  beforeEach(() => {
    agents.current = [
      { id: "agent-live", name: "Checkout assistant", type: "workflow" },
    ];
    // `mockReset`, not `mockClear`: the failure case below replaces the
    // implementation outright, and React invokes the hook's effect more than
    // once, so a `…Once` rejection would be consumed by the first invocation
    // and the retry would quietly succeed.
    getAllFetch.mockReset();
    getAllFetch.mockImplementation(async () => agents.current);
  });

  describe("given the agent the model named still exists", () => {
    it("shows the agent's own name rather than the id it was referred to by", async () => {
      const { result } = renderHook(() =>
        useChoicesRefRows(askWhichAgent("agent-live")),
      );

      await waitFor(() =>
        expect(result.current.get("option-1")?.state).toBe("live"),
      );
      const row = result.current.get("option-1");
      expect(row).toMatchObject({
        state: "live",
        primary: "Checkout assistant",
      });
    });

    it("carries what tells two similarly-named agents apart", async () => {
      const { result } = renderHook(() =>
        useChoicesRefRows(askWhichAgent("agent-live")),
      );

      await waitFor(() =>
        expect(result.current.get("option-1")?.state).toBe("live"),
      );
      expect(result.current.get("option-1")).toMatchObject({
        secondary: "workflow",
      });
    });
  });

  describe("given the agent is gone, archived, or invisible to this viewer", () => {
    // The whole point of resolving AS THE VIEWER: the model asserted this
    // option, and the panel is not obliged to honour it.
    it("marks the option dead so it cannot be selected", async () => {
      const { result } = renderHook(() =>
        useChoicesRefRows(askWhichAgent("agent-archived")),
      );

      await waitFor(() =>
        expect(result.current.get("option-1")?.state).toBe("dead"),
      );
      // Never `plain`: plain renders from the model's own label and stays
      // selectable, which is exactly the state this fix removes.
      expect(result.current.get("option-1")?.state).not.toBe("plain");
    });
  });

  describe("when the lookup itself fails", () => {
    it("leaves the option selectable rather than disabling on a blip", async () => {
      getAllFetch.mockRejectedValue(new Error("network"));

      const { result } = renderHook(() =>
        useChoicesRefRows(askWhichAgent("agent-live")),
      );

      await waitFor(() =>
        expect(result.current.get("option-1")?.state).toBe("plain"),
      );
    });
  });
});
