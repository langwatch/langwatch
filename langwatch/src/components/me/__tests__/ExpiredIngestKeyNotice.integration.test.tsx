/**
 * @vitest-environment jsdom
 *
 * Spec: specs/ai-governance/cli-onboarding/expired-ingest-key-notice.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ExpiredIngestKeyNoticeView } from "../ExpiredIngestKeyNotice";

function renderNotice(
  overrides: Partial<
    React.ComponentProps<typeof ExpiredIngestKeyNoticeView>
  > = {},
) {
  const onDismiss = overrides.onDismiss ?? vi.fn();
  const utils = render(
    <ChakraProvider value={defaultSystem}>
      <ExpiredIngestKeyNoticeView {...overrides} onDismiss={onDismiss} />
    </ChakraProvider>,
  );
  return { ...utils, onDismiss };
}

describe("ExpiredIngestKeyNoticeView", () => {
  afterEach(() => {
    cleanup();
  });

  /** @scenario "The notice says what broke and how to fix it" */
  it("says the agent's traces were dropped and names the login command", () => {
    renderNotice();

    const text = screen.getByRole("alert").textContent ?? "";
    expect(text).toMatch(/coding agent/i);
    expect(text).toMatch(/no longer valid/i);
    expect(text).toContain("langwatch login --device");
  });

  it("keeps the copy plain: no em-dashes, no marketing", () => {
    renderNotice();

    const text = screen.getByRole("alert").textContent ?? "";
    expect(text).not.toContain("—");
    expect(text.length).toBeLessThan(200);
  });

  /** @scenario "The notice can be dismissed" */
  it("dismisses on the close button", () => {
    const { onDismiss } = renderNotice();

    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));

    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("blocks a second dismiss while the first is in flight", () => {
    const onDismiss = vi.fn();
    renderNotice({ onDismiss, dismissing: true });

    const button = screen.getByRole("button", { name: /dismiss/i });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
