/**
 * @vitest-environment jsdom
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { DevBadge } from "../dev-badge.tsx";

afterEach(cleanup);

const LONG_SLUG = "issue1234-a-very-long-worktree-branch-name-that-cannot-fit-in-the-top-bar";

function renderBadge(label?: string) {
  renderWithDesignSystem(<DevBadge label={label} />);
}

function badge() {
  return screen.getByText("DEV").parentElement!;
}

describe("given a development build on a haven stack", () => {
  /** @scenario "the development badge shows the stack's slug" */
  it("reads DEV followed by the stack's slug", async () => {
    renderBadge("feat-strict-feature-layout-v0");

    expect(badge()).toHaveTextContent("DEV · feat-strict-feature-layout-v0");

    await userEvent.hover(badge());

    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      'Development build, running the "feat-strict-feature-layout-v0" stack',
    );
  });

  /** @scenario "a long stack slug truncates with the full name in a tooltip" */
  it("truncates a long slug and shows it whole on hover", async () => {
    renderBadge(LONG_SLUG);

    expect(getComputedStyle(badge()).textOverflow).toBe("ellipsis");
    expect(getComputedStyle(badge()).whiteSpace).toBe("nowrap");

    await userEvent.hover(badge());

    expect(await screen.findByRole("tooltip")).toHaveTextContent(LONG_SLUG);
  });
});

describe("given a keyboard reader", () => {
  it("reaches the badge with Tab and shows the full slug in the tooltip", async () => {
    renderBadge(LONG_SLUG);

    await userEvent.tab();

    expect(badge()).toHaveFocus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent(LONG_SLUG);
  });
});

describe("given a development build outside haven", () => {
  /** @scenario "a development build outside haven still reads DEV" */
  it("reads DEV", async () => {
    renderBadge();

    expect(badge()).toHaveTextContent(/^DEV$/);

    await userEvent.hover(badge());

    expect(await screen.findByRole("tooltip")).toHaveTextContent("Development build");
  });
});
