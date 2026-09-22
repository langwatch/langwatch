/**
 * @vitest-environment jsdom
 * The danger zone: what removing a connection does depends on whether it is
 * carrying anybody, and the words change with it.
 */

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithSsoHost } from "../../../testing.tsx";
import { ConnectionRemovalSection } from "../connection-removal.section.tsx";

function renderSection(
  overrides: {
    state?: Parameters<typeof ConnectionRemovalSection>[0]["state"];
    tearDownAfterMs?: number | null;
    pending?: boolean;
    settling?: boolean;
  } = {},
) {
  const onRemove = vi.fn();
  const rendered = renderWithSsoHost(
    <ConnectionRemovalSection
      state={overrides.state ?? "DRAFT"}
      providerName="Acme Okta"
      tearDownAfterMs={overrides.tearDownAfterMs ?? null}
      pending={overrides.pending ?? false}
      settling={overrides.settling ?? false}
      onRemove={onRemove}
    />,
  );

  return { ...rendered, onRemove };
}

afterEach(cleanup);

describe("given a connection nobody signs in through yet", () => {
  it("promises the way back to the start, and nothing about anybody's sign-in", () => {
    renderSection({ state: "DRAFT" });

    expect(screen.getByText(/Removing Acme Okta takes you back to the start/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove this connection" })).toBeTruthy();
  });

  it("discards it once, and only after it was asked a second time", () => {
    const { onRemove } = renderSection({ state: "DRAFT" });
    fireEvent.click(screen.getByTestId("sso-remove-open"));

    expect(onRemove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Yes, remove it" }));

    expect(onRemove.mock.calls[0]?.[0]).toEqual({ verb: "discard" });
  });

  it("keeps the connection when the reader backs out", () => {
    const { onRemove } = renderSection({ state: "DRAFT" });
    fireEvent.click(screen.getByTestId("sso-remove-open"));
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));

    expect(onRemove).not.toHaveBeenCalled();
    expect(screen.getByTestId("sso-remove-open")).toBeTruthy();
  });
});

describe("given a live connection", () => {
  it("says what stops immediately and what does not, and schedules rather than removes", () => {
    const { onRemove } = renderSection({ state: "ACTIVE" });

    expect(screen.getByText(/immediately stops new SSO sign-ins/)).toBeTruthy();
    expect(screen.getByText(/Existing sessions and member access remain active/)).toBeTruthy();

    fireEvent.click(screen.getByTestId("sso-remove-open"));
    fireEvent.click(screen.getByRole("button", { name: "Yes, schedule the removal" }));

    expect(onRemove.mock.calls[0]?.[0]).toEqual({ verb: "teardown", alreadyScheduled: false });
  });
});

describe("given a connection already on its way out", () => {
  it("names the day it ends and offers to bring that forward", () => {
    const { onRemove } = renderSection({
      state: "TEARDOWN_PENDING",
      tearDownAfterMs: Date.UTC(2026, 1, 9, 12),
    });

    expect(screen.getByText(/already being removed, on 9 February 2026/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Remove now" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, remove now" }));

    expect(onRemove.mock.calls[0]?.[0]).toEqual({ verb: "teardown", alreadyScheduled: true });
  });

  it("says it plainly when no date is known yet", () => {
    renderSection({ state: "TEARDOWN_PENDING", tearDownAfterMs: null });

    expect(screen.getByText(/already being removed\. New SSO sign-ins/)).toBeTruthy();
  });
});

describe("given a paused connection", () => {
  it("schedules the removal rather than discarding it", () => {
    const { onRemove } = renderSection({ state: "SUSPENDED" });
    fireEvent.click(screen.getByTestId("sso-remove-open"));
    fireEvent.click(screen.getByRole("button", { name: "Yes, schedule the removal" }));

    expect(onRemove.mock.calls[0]?.[0]).toEqual({ verb: "teardown", alreadyScheduled: false });
  });
});

describe("given a connection there is nothing left to remove", () => {
  it("draws no danger zone at all", () => {
    renderSection({ state: "TORN_DOWN" });

    expect(screen.queryByTestId("sso-remove")).toBeNull();
  });
});

describe("while a removal is settling", () => {
  it("says the status is catching up, rather than reading as unchanged", () => {
    renderSection({ state: "TEARDOWN_PENDING", settling: true });

    expect(screen.getByRole("status").textContent).toContain("Removal accepted");
  });

  it("cannot be asked a second time before the new state is readable", () => {
    renderSection({ state: "TEARDOWN_PENDING", settling: true });

    expect(screen.getByTestId("sso-remove-open")).toHaveProperty("disabled", true);
  });
});
