// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * Where the Agents page puts the controls that narrow its list: one row, above the list, left-aligned.
 * Real page over the fake host; only the tRPC client and the drawer opener are doubled.
 * @see specs/ai-governance/dashboard/governance-ui-controls.feature
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SAMPLE_AGENT_ROWS } from "../../../../features/agents/agent-rows.ts";
import { fakeGovernanceHost, renderWithGovernanceHost } from "../../../../testing.tsx";
import { SAMPLE_CHOICE_KEY } from "../../../../ui/elements/governance-sample-mode.ts";

vi.mock("@langwatch/browser-host/drawer", async () => ({
  ...(await vi.importActual("@langwatch/browser-host/drawer")),
  useDrawer: () => ({ openDrawer: vi.fn(), closeDrawer: vi.fn(), goBack: vi.fn() }),
}));

vi.mock("../../../../behavior/governance-api.ts", () => {
  const node = (path: string[]): unknown =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (typeof property !== "string") return undefined;
          if (property === "useQuery") {
            return () => ({ data: undefined, isLoading: false, error: null });
          }
          if (property === "useMutation") {
            return () => ({ mutate: vi.fn(), isPending: false, error: null });
          }
          return node([...path, property]);
        },
      },
    );
  const api = node([]);
  return { api, governanceApi: api };
});

import AgentsPage from "../agents.tsx";

const CONTROLS = ["Source", "Ownership", "Sort"];

const control = (label: string) => {
  const found = screen.getAllByRole("button").find((b) => b.textContent?.startsWith(label));
  if (!found) throw new Error(`no ${label} chip`);
  return found;
};

beforeEach(() => window.sessionStorage.setItem(SAMPLE_CHOICE_KEY, "true"));
afterEach(() => cleanup());

describe("given a governance page with filters and a sort control", () => {
  /** @scenario "Every filter and sort control sits in one row above the content it narrows" */
  it("holds the source, ownership and sort chips in one left-aligned row above every agent row, with nothing else filtered between it and the header", () => {
    renderWithGovernanceHost(
      <MemoryRouter>
        <AgentsPage />
      </MemoryRouter>,
      { host: fakeGovernanceHost({ permissions: ["governance:view", "governance:manage"] }) },
    );

    const row = control("Source").parentElement as HTMLElement;
    for (const label of CONTROLS) expect(control(label).parentElement).toBe(row);
    expect(row.children).toHaveLength(CONTROLS.length);

    const after = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const region = screen.getByTestId("governance-agents-table");
    const agentRows = screen.getAllByTestId("governance-agent-row");
    expect(agentRows).toHaveLength(SAMPLE_AGENT_ROWS.length);
    expect(row).not.toContainElement(region);
    expect(region).not.toContainElement(row);
    expect(after(row, region)).toBe(true);
    for (const agent of agentRows) expect(after(row, agent)).toBe(true);

    const header = screen.getByRole("heading", { name: "Agents" });
    const betweenHeaderAndRow = Array.from(document.body.querySelectorAll("*")).filter(
      (element) => after(header, element) && after(element, row) && !element.contains(row),
    );
    expect(
      betweenHeaderAndRow.filter((element) => element.matches('[data-testid^="governance-agent"]')),
    ).toEqual([]);

    const style = getComputedStyle(row);
    expect(["", "normal", "flex-start", "start"]).toContain(style.justifyContent);
    expect(style.flexWrap).toBe("wrap");

    const chipsElsewhere = screen
      .getAllByRole("button")
      .filter((button) => CONTROLS.some((label) => button.textContent?.startsWith(label)))
      .filter((button) => !row.contains(button));
    expect(chipsElsewhere).toEqual([]);
  });
});
