/**
 * @vitest-environment jsdom
 * The way back in as an administrator grants it: who holds one, where they
 * spend it, and an end date the server will actually accept.
 */

import { BREAK_GLASS_MAX_WINDOW_MS } from "@langwatch/identity-contract";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  BreakGlassCandidateView,
  BreakGlassGrantView,
} from "../../../model/break-glass-grants.ts";
import { renderWithSsoHost } from "../../../testing.tsx";
import { BreakGlassSection } from "../break-glass.section.tsx";

const HOLDER: BreakGlassGrantView = {
  bindingId: "bg_1",
  userId: "user_1",
  name: "Jane Doe",
  email: "jane@acme.com",
  grantedByName: "Sam Owner",
  expiresAtMs: Date.UTC(2026, 1, 9, 12),
  daysRemaining: 12,
  live: true,
};

const CANDIDATES: BreakGlassCandidateView[] = [
  { userId: "user_2", name: "Ada Lovelace", email: "ada@acme.com", holdsPassword: true },
  { userId: "user_3", name: "Grace Hopper", email: "grace@acme.com", holdsPassword: false },
];

function renderSection(
  overrides: {
    grants?: BreakGlassGrantView[];
    candidates?: BreakGlassCandidateView[];
    canManage?: boolean;
  } = {},
) {
  const onGrant = vi.fn();
  const onRenew = vi.fn();
  const onRevoke = vi.fn();
  const rendered = renderWithSsoHost(
    <BreakGlassSection
      canManage={overrides.canManage ?? true}
      grants={overrides.grants ?? []}
      candidates={overrides.candidates ?? CANDIDATES}
      onGrant={onGrant}
      onRenew={onRenew}
      onRevoke={onRevoke}
    />,
  );

  return { ...rendered, onGrant, onRenew, onRevoke };
}

afterEach(cleanup);

describe("given an organization nobody holds a way back in for", () => {
  it("says so plainly", () => {
    renderSection();

    expect(screen.getByText("Nobody can get in without your identity provider yet.")).toBeTruthy();
  });

  it("does not hand out the address yet, because there is nobody to send it to", () => {
    renderSection();

    expect(screen.queryByTestId("connection-break-glass-address")).toBeNull();
  });
});

describe("given the words the section is offered in", () => {
  /** @scenario "A way back in is not offered in our words" */
  it("describes it as a password that still works, naming nothing of ours", () => {
    const { container } = renderSection();

    expect(
      screen.getByText(/can still sign in with a password if it ever stops working/),
    ).toBeTruthy();
    expect(container.textContent).not.toMatch(/break.glass|binding|SAML|OIDC|provisioning/i);
  });
});

describe("given a live grant", () => {
  it("names the holder, who gave it, and the day it ends in words", () => {
    renderSection({ grants: [HOLDER] });

    expect(screen.getByText("Jane Doe")).toBeTruthy();
    expect(screen.getByText("Granted by Sam Owner")).toBeTruthy();
    expect(screen.getByText("9 February 2026")).toBeTruthy();
    expect(screen.getByText("12 days left")).toBeTruthy();
  });

  it("gives the one address that still asks for a password, to send on", () => {
    renderSection({ grants: [HOLDER] });

    expect(screen.getByTestId("connection-break-glass-address")).toBeTruthy();
    expect(screen.getByText(`${window.location.origin}/auth/signin?local=1`)).toBeTruthy();
  });

  it("extends it to the date the picker is holding, to the end of that day", () => {
    const { onRenew } = renderSection({ grants: [HOLDER] });
    fireEvent.change(screen.getByLabelText("Until"), { target: { value: "2026-03-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Extend to the date below" }));

    const command = onRenew.mock.calls[0]?.[0];
    expect(command?.bindingId).toBe("bg_1");
    expect(new Date(command?.expiresAtMs ?? 0).getDate()).toBe(1);
  });

  it("ends it now, naming the grant and nothing else", () => {
    const { onRevoke } = renderSection({ grants: [HOLDER] });
    fireEvent.click(screen.getByRole("button", { name: "End now" }));

    expect(onRevoke.mock.calls[0]?.[0]).toEqual({ bindingId: "bg_1" });
  });
});

describe("given a grant a renewal replaced", () => {
  it("offers nothing to do to it, and reads as no way in at all", () => {
    renderSection({ grants: [{ ...HOLDER, live: false }] });

    expect(screen.queryByTestId("connection-break-glass-row")).toBeNull();
    expect(screen.getByText("Nobody can get in without your identity provider yet.")).toBeTruthy();
  });
});

describe("when an administrator grants a way back in", () => {
  it("names the person and the end of the local day they picked", () => {
    const { onGrant } = renderSection();
    fireEvent.change(screen.getByLabelText("Who can still get in"), {
      target: { value: "user_2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Grant a way back in" }));

    const command = onGrant.mock.calls[0]?.[0];
    expect(command?.userId).toBe("user_2");
    expect(new Date(command?.expiresAtMs ?? 0).getHours()).toBe(23);
  });

  // The default used to be the maximum, which `endOfLocalDay` then rounded
  // past the window: every grant taken at face value was refused.
  it("starts on a date the server's window still accepts", () => {
    const { onGrant } = renderSection();
    fireEvent.change(screen.getByLabelText("Who can still get in"), {
      target: { value: "user_2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Grant a way back in" }));

    const expiresAtMs = onGrant.mock.calls[0]?.[0]?.expiresAtMs ?? 0;
    expect(expiresAtMs).toBeGreaterThan(Date.now());
    expect(expiresAtMs).toBeLessThanOrEqual(Date.now() + BREAK_GLASS_MAX_WINDOW_MS);
  });

  it("offers no date beyond that window either", () => {
    renderSection();
    const until = screen.getByLabelText("Until") as HTMLInputElement;

    expect(Date.parse(until.max)).toBeLessThan(Date.now() + BREAK_GLASS_MAX_WINDOW_MS);
    expect(Date.parse(until.min)).toBeGreaterThan(Date.now() - 86_400_000);
  });

  it("does not ask with nobody chosen", () => {
    renderSection();

    expect(screen.getByRole("button", { name: "Grant a way back in" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("shows somebody who holds no password, and why they cannot be chosen", () => {
    renderSection();
    const option = screen.getByRole("option", { name: "Grace Hopper (set a password first)" });

    expect(option).toHaveProperty("disabled", true);
  });
});

describe("given a reader who may not manage single sign-on", () => {
  it("shows who holds a way in and offers no control over it", () => {
    renderSection({ grants: [HOLDER], canManage: false });

    expect(screen.getByText("Jane Doe")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "End now" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Grant a way back in" })).toBeNull();
  });
});
