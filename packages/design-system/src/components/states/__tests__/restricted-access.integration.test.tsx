// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccessState, UpgradeRequired } from "../access-state.tsx";
import { RestrictedAccess } from "../restricted-access.tsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("given a permission gate", () => {
  /** @scenario A reader can copy a permission request for their admin */
  it("copies the permission and current address, then explains where to send them", async () => {
    const writeText = vi.fn().mockResolvedValue(void 0);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    renderWithDesignSystem(<RestrictedAccess permission="virtualKeys:view" compact />);
    expect(screen.getByText(/view virtual keys/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy access request" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining("Missing permission: virtualKeys:view"),
      ),
    );
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining(window.location.href));
    expect(await screen.findByRole("status")).toHaveTextContent("Send the copied request");
  });

  /** @scenario A failed copy still explains how to ask for access */
  it("keeps a usable fallback when clipboard access fails", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("Unavailable")) },
    });
    renderWithDesignSystem(<RestrictedAccess permission="governance:view" compact />);
    fireEvent.click(screen.getByRole("button", { name: "Copy access request" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Send this page's address and the permission governance:view",
    );
    expect(screen.queryByText("Request copied")).toBeNull();
  });

  /** @scenario A Lite member asks for access without a plan purchase */
  it("allows the containing dialog to close without offering an upgrade", () => {
    const onBack = vi.fn();
    renderWithDesignSystem(<RestrictedAccess compact area="this feature" onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(screen.queryByText(/compare plans/i)).toBeNull();
  });
});

describe("given a page that needs platform operator access", () => {
  /** @scenario "An organization admin without platform operator access opens an operator page" */
  it("says it needs platform operator access, not an organization admin", () => {
    renderWithDesignSystem(<RestrictedAccess permission="ops:view" />);
    expect(
      screen.getByText(
        "This page needs platform operator access. It is for the people who run this LangWatch install.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/Ask an organization admin/)).toBeNull();
  });
});

describe("given an Enterprise gate", () => {
  /** @scenario An Enterprise gate names the missing plan and offers a next step */
  it("names the feature and preserves the owner's action", () => {
    renderWithDesignSystem(
      <UpgradeRequired
        feature="Single sign-on"
        actions={<a href="/settings/plans">Compare plans</a>}
      />,
    );
    expect(screen.getByRole("heading", { name: "Single sign-on on Enterprise" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Compare plans" })).toHaveAttribute(
      "href",
      "/settings/plans",
    );
  });
});

describe("given an access gate inside a card", () => {
  /** @scenario A gate inside a card draws no box of its own */
  it("puts the lock beside the words and keeps the title, description and actions", () => {
    renderWithDesignSystem(
      <AccessState
        kind="permission"
        title="Directory sync is locked"
        description="Ask an organization admin for access."
        actions={<button type="button">Request access</button>}
        inset
        data-testid="gate"
      />,
    );
    const gate = screen.getByTestId("gate");
    const [icon, words] = Array.from(gate.children);

    expect(gate).toHaveAttribute("data-inset");
    expect(icon?.querySelector("svg")).toBeTruthy();
    expect(words).toContainElement(
      screen.getByRole("heading", { name: "Directory sync is locked" }),
    );
    expect(words).toHaveTextContent("Ask an organization admin for access.");
    expect(words).toContainElement(screen.getByRole("button", { name: "Request access" }));
  });

  /** @scenario A gate inside a card draws no box of its own */
  it("stacks the lock above the words when it draws its own box", () => {
    renderWithDesignSystem(
      <AccessState
        kind="permission"
        title="Locked"
        description="Ask an admin."
        data-testid="gate"
      />,
    );
    const gate = screen.getByTestId("gate");

    expect(gate).not.toHaveAttribute("data-inset");
    expect(gate.firstElementChild).toContainElement(
      screen.getByRole("heading", { name: "Locked" }),
    );
  });
});
