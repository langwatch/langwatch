// @vitest-environment jsdom
// The home's figures are analytics' lent graph, drawn under analytics' own host.
// Spec: specs/home/home-views.feature

import "@testing-library/jest-dom/vitest";
import { CustomGraphToken, type CustomGraphInput } from "@langwatch/analytics-client";
import { uiDeclarations, type UiDeclarations } from "@langwatch/browser-host/declarations";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const declarations: { current: UiDeclarations | undefined } = vi.hoisted(() => ({
  current: undefined,
}));

vi.mock("@langwatch/browser-host/capabilities", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useUiDeclarations: () => declarations.current,
}));

import { CustomGraph } from "../lent-peers.tsx";

const graphInput: CustomGraphInput = {
  graphId: "custom",
  graphType: "line",
  series: [],
  includePrevious: false,
  timeScale: 1,
};

afterEach(() => {
  cleanup();
  declarations.current = undefined;
});

describe("the analytics surfaces the project home draws", () => {
  /** @scenario "The project home renders the analytics surfaces it draws" */
  it("draws analytics' graph through its lend, with no analytics host mounted by the home", async () => {
    declarations.current = uiDeclarations([
      {
        name: "analytics",
        installation: {
          capabilities: {},
          lends: [
            {
              token: CustomGraphToken,
              load: async () => ({
                default: ({ input }: { input: CustomGraphInput }) => (
                  <span>{input.graphType} graph</span>
                ),
              }),
            },
          ],
        },
      },
    ]);
    render(<CustomGraph input={graphInput} />);
    expect(await screen.findByText("line graph")).toBeInTheDocument();
  });

  /** @scenario "The project home renders the analytics surfaces it draws" */
  it("renders without the graph, rather than failing, when analytics lends nothing", () => {
    declarations.current = uiDeclarations([]);
    expect(() => render(<CustomGraph input={graphInput} />)).not.toThrow();
  });
});
