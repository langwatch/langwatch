/**
 * @vitest-environment jsdom
 * The organisation's docs playground switch: on by default, and what turning it off says.
 * @see modules/api-key/specs/docs-session-keys.feature
 */
import "@testing-library/jest-dom/vitest";
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DocsPlaygroundCard } from "../docs-playground-card.tsx";

afterEach(cleanup);

function renderCard({ sessionsEnabled }: { sessionsEnabled: boolean }) {
  const onChange = vi.fn();
  render(
    <DesignSystemProvider>
      <DocsPlaygroundCard sessionsEnabled={sessionsEnabled} saving={false} onChange={onChange} />
    </DesignSystemProvider>,
  );
  return { onChange };
}

describe("given an organisation admin on the security policies", () => {
  /** @scenario "An organisation turns the playground session off" */
  it("turns docs playground sessions off with the switch", async () => {
    const { onChange } = renderCard({ sessionsEnabled: true });

    expect(screen.getByText("Docs playground sessions")).toBeInTheDocument();
    expect(screen.getByTestId("docs-playground-switch")).toBeChecked();
    await userEvent.setup().click(screen.getByTestId("docs-playground-switch"));

    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("turns them back on", async () => {
    const { onChange } = renderCard({ sessionsEnabled: false });

    expect(screen.getByTestId("docs-playground-switch")).not.toBeChecked();
    await userEvent.setup().click(screen.getByTestId("docs-playground-switch"));

    expect(onChange).toHaveBeenCalledWith(true);
  });
});
