/**
 * The project picker's hover ID in real Chromium: jsdom measures nothing, so only a real
 * engine can say the ID leaves the popup's width alone and the long name gives way.
 * @see specs/navigation/one-project-picker.feature
 */
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";

import { ProjectPicker } from "../../src/components/scope/project-picker.tsx";
import { renderWithDesignSystem } from "../../src/testing/index.tsx";

afterEach(cleanup);

const LONG_NAME = "Customer support assistant for the European billing desk";
const LONG_ID = "project_0000aBcDeFgHiJSr4Pwe";

function mount() {
  renderWithDesignSystem(
    <ProjectPicker
      groups={[
        {
          team: { teamId: "team-a", orgId: "org-1", label: "Platform" },
          projects: [
            { projectId: "project_0000kLmNoPqRsTH1Ziwj", label: "Web", href: "/web" },
            { projectId: LONG_ID, label: LONG_NAME, href: "/long" },
          ],
        },
      ]}
      currentProjectId="project_0000kLmNoPqRsTH1Ziwj"
      currentProjectName="Web"
      showTeamHeaders={false}
      onOpenProject={() => undefined}
    />,
  );
}

describe("the project picker's hover ID in a real engine", () => {
  /** @scenario "A long project name gives way to the ID" */
  it("truncates the long name, keeps the ID inside the row, and keeps the popup's width", async () => {
    mount();
    await userEvent.click(screen.getByRole("button", { name: "Switch project" }));
    const option = await screen.findByRole("option", { name: new RegExp(LONG_NAME) });
    const popup = option.closest("[data-part='content']") as HTMLElement;
    const widthAtRest = popup.getBoundingClientRect().width;

    await userEvent.hover(option);
    const id = await screen.findByTitle(LONG_ID);

    expect(popup.getBoundingClientRect().width).toBe(widthAtRest);
    const row = option.getBoundingClientRect();
    const drawnId = id.getBoundingClientRect();
    expect(drawnId.width).toBeGreaterThan(0);
    expect(drawnId.right).toBeLessThanOrEqual(row.right);
    const name = screen.getByText(LONG_NAME);
    expect(name.scrollWidth).toBeGreaterThan(name.clientWidth);
    expect(name.getBoundingClientRect().right).toBeLessThanOrEqual(drawnId.left);
  });
});
