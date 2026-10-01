/**
 * A persisted preference belongs to the reader the session answered with, and
 * sign-out forgets it. Spec: specs/ui/browser-global-store.feature.
 * @vitest-environment jsdom
 */

import { UiFeedback } from "@langwatch/browser-host/capabilities";
import { defineSlice } from "@langwatch/browser-host/global-store";
import { clearReaderUiStorage } from "@langwatch/browser-host/storage";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { UiAuthClient } from "../../session";
import { useUiSessionReading } from "../ui-session";
import { signOutUi } from "../ui-session-client";

type Panel = { width: number };

const panel = () =>
  defineSlice<Panel>({
    name: "probe:panel",
    create: () => ({ width: 200 }),
    persist: { partialize: ({ width }) => ({ width }) },
  });

const signedInAs = (id: string): UiAuthClient => ({
  $fetch: () => Promise.resolve({ data: { user: { id, name: id, email: null, image: null } } }),
  signOut: () => Promise.resolve(),
});

class SilentFeedback extends UiFeedback {
  succeeded(): void {}
  failed(): void {}
}

function SessionProbe({ authClient }: { authClient: UiAuthClient }) {
  const reading = useUiSessionReading({
    feedback: new SilentFeedback(),
    isPublicRoute: true,
    authClient,
  });
  return <span data-testid="user">{reading.user?.id ?? "nobody"}</span>;
}

let dispose: (() => void) | undefined;

/** One page load: a fresh cache and router, with the session read answered by `authClient`. */
async function loadPageAs(id: string) {
  dispose?.();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <QueryClientProvider client={queryClient}>
            <SessionProbe authClient={signedInAs(id)} />
          </QueryClientProvider>
        ),
      },
    ],
    { initialEntries: ["/"] },
  );
  const view = render(<RouterProvider router={router} />);
  dispose = () => {
    view.unmount();
    router.dispose();
  };
  await waitFor(() => expect(view.getByTestId("user").textContent).toBe(id));
}

beforeEach(() => {
  clearReaderUiStorage();
  window.localStorage.clear();
});

afterEach(() => {
  dispose?.();
  dispose = void 0;
});

describe("given a reader who widened a persisted panel", () => {
  /** @scenario "A persisted preference belongs to the reader who chose it" */
  it("keeps the width across a reload for the same reader", async () => {
    await loadPageAs("user-jane");
    panel().setState({ width: 480 });

    await loadPageAs("user-jane");

    expect(panel().getState().width).toBe(480);
  });

  /** @scenario "A persisted preference belongs to the reader who chose it" */
  it("shows a different reader on the same device the default width", async () => {
    await loadPageAs("user-jane");
    panel().setState({ width: 480 });

    await loadPageAs("user-joe");

    expect(panel().getState().width).toBe(200);
  });

  /** @scenario "Sign-out forgets every persisted preference on the device" */
  it("forgets the width when the reader signs out", async () => {
    await loadPageAs("user-jane");
    panel().setState({ width: 480 });

    await signOutUi(signedInAs("user-jane"));
    await loadPageAs("user-jane");

    expect(panel().getState().width).toBe(200);
    expect(window.localStorage.length).toBe(0);
  });
});

describe("given a tab that kept drafts, a verifier and attribution in session storage", () => {
  /** @scenario "Sign-out clears everything the tab kept in session storage" */
  it("clears every key when the reader signs out", async () => {
    window.sessionStorage.setItem("voice-agent-draft:project_1", "{}");
    window.sessionStorage.setItem("lw.identity.address-verifier.identifier_1", "verifier");
    window.sessionStorage.setItem("lw_attrib.leadSource", "docs");

    await signOutUi(signedInAs("user-jane"));

    expect(window.sessionStorage.length).toBe(0);
  });
});
