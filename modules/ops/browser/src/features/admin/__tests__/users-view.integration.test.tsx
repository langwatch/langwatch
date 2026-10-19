/**
 * @vitest-environment jsdom
 */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeOpsHost, renderWithOpsHost, type FakeOpsHost } from "../../../testing.tsx";
import { impersonateUser } from "../behavior/admin-client.ts";
import UsersView, { ImpersonateDialog } from "../ui/sections/users-view.tsx";

vi.mock("../behavior/admin-client.ts", () => ({
  impersonateUser: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../behavior/use-admin-resource.ts", () => ({
  useAdminList: () => ({
    data: { total: 1, data: [rowUser] },
    isLoading: false,
    isFetching: false,
    error: null,
  }),
  useAdminUpdate: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

/**
 * The refusal reaches the operator through the host, not through a module
 * singleton: `toaster.create({ type: "error" })` is a `failed` notice on
 * `OpsHostApi`, so the assertion reads the recording the fake host keeps.
 */
let host: FakeOpsHost;

/** jsdom lays nothing out, so the focus trap would treat every element as hidden. */
function stubLayout() {
  const rect = new DOMRect(0, 0, 10, 10);
  const rects: DOMRectList = {
    0: rect,
    length: 1,
    item: (index: number) => (index === 0 ? rect : null),
    [Symbol.iterator]: () => [rect][Symbol.iterator](),
  };
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue(rects);
}

const { rowUser } = vi.hoisted(() => ({
  rowUser: {
    id: "user-1",
    name: "Yoel Ernst",
    email: "yoel@example.com",
    image: null,
    emailVerified: true,
    pendingSsoSetup: false,
    createdAt: "2026-04-01T10:00:00.000Z",
    lastLoginAt: null,
    deactivatedAt: null,
    organizations: [],
    projects: [],
  },
}));

const user = {
  id: "user-1",
  name: "Yoel Ernst",
  email: "yoel@example.com",
  image: null,
  emailVerified: true,
  pendingSsoSetup: false,
  createdAt: "2026-04-01T10:00:00.000Z",
  lastLoginAt: null,
  deactivatedAt: null,
  organizations: [],
  projects: [],
};

describe("Feature: Admin User Impersonation Reason", () => {
  beforeEach(() => {
    vi.mocked(impersonateUser).mockClear();
    stubLayout();
    host = fakeOpsHost({ isOpsAdmin: true });
  });

  describe("given the ops admin has opened the impersonation dialog", () => {
    /** @scenario Impersonation dialog asks for a single-line reason */
    it("shows a single-line reason field", () => {
      renderWithOpsHost(<ImpersonateDialog user={user} onClose={vi.fn()} />, { host });

      const reason = screen.getByLabelText("Reason");

      expect(screen.getByText(/saved to the audit log/i)).toBeInTheDocument();
      expect(reason.tagName).toBe("INPUT");
    });

    /** @scenario Impersonation dialog focuses the reason field on open */
    it("focuses the reason field as soon as the dialog opens", async () => {
      renderWithOpsHost(<ImpersonateDialog user={user} onClose={vi.fn()} />, { host });

      const reason = screen.getByLabelText("Reason");
      await waitFor(() => {
        expect(document.activeElement).toBe(reason);
      });
    });

    /** @scenario Enter submits a completed impersonation reason */
    it("submits the reason when Enter is pressed", async () => {
      const testingUser = userEvent.setup();
      renderWithOpsHost(<ImpersonateDialog user={user} onClose={vi.fn()} />, { host });

      await testingUser.type(screen.getByLabelText("Reason"), "support");
      fireEvent.keyDown(screen.getByLabelText("Reason"), {
        key: "Enter",
        code: "Enter",
      });

      await waitFor(() => {
        expect(impersonateUser).toHaveBeenCalledWith({
          userIdToImpersonate: "user-1",
          reason: "support",
        });
      });
    });

    /** @scenario Empty reason still blocks impersonation */
    it("keeps blocking empty reasons when Enter is pressed", async () => {
      renderWithOpsHost(<ImpersonateDialog user={user} onClose={vi.fn()} />, { host });

      fireEvent.keyDown(screen.getByLabelText("Reason"), {
        key: "Enter",
        code: "Enter",
      });

      expect(impersonateUser).not.toHaveBeenCalled();
      expect(host.recording.failures).toContainEqual(
        expect.objectContaining({
          fallbackTitle: "Reason is required",
          description: "Saved to the audit log alongside the impersonation.",
        }),
      );
    });
  });
});

describe("Feature: Impersonating from the row menu", () => {
  beforeEach(() => {
    vi.mocked(impersonateUser).mockClear();
    stubLayout();
    host = fakeOpsHost({ isOpsAdmin: true });
  });

  it("moves focus to the reason, keeps Tab inside, and returns to the row's menu trigger", async () => {
    const testingUser = userEvent.setup();
    renderWithOpsHost(<UsersView />, { host });

    const trigger = document.querySelector<HTMLElement>("[aria-haspopup='menu']");
    if (!trigger) throw new Error("expected the row menu trigger");
    await testingUser.click(trigger);
    await testingUser.click(await screen.findByRole("menuitem", { name: /Impersonate/ }));

    const dialog = await screen.findByRole("dialog", { name: "Impersonate user" });
    const reason = screen.getByLabelText("Reason");
    await waitFor(() => expect(document.activeElement).toBe(reason));
    await testingUser.keyboard("ticket");
    expect(reason).toHaveValue("ticket");
    for (let step = 0; step < 5; step += 1) {
      await testingUser.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await testingUser.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);

    await testingUser.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Impersonate user" })).toBeNull(),
    );
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("holds Cancel and the X while the impersonation is in flight", async () => {
    vi.mocked(impersonateUser).mockReturnValueOnce(new Promise(() => undefined));
    const onClose = vi.fn();
    const testingUser = userEvent.setup();
    renderWithOpsHost(<ImpersonateDialog user={rowUser} onClose={onClose} />, { host });

    await testingUser.type(screen.getByLabelText("Reason"), "support");
    await testingUser.click(screen.getByRole("button", { name: "Impersonate" }));
    await testingUser.keyboard("{Escape}");

    expect(impersonateUser).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });
});
