/**
 * @vitest-environment jsdom
 * The docs consent popup (ADR-185): what it refuses, and what it posts to the docs.
 * @see modules/api-key/specs/docs-session-keys.feature
 */

import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { FakeAuthorizeHost, renderWithAuthorizeHost } from "../../../testing.tsx";
import DocsConnect from "../docs-connect-screen.tsx";

const DOCS = "https://langwatch.ai";
const STATE = "A".repeat(43);

function hostWith(options: ConstructorParameters<typeof FakeAuthorizeHost>[0] = {}) {
  return new FakeAuthorizeHost({
    projectId: "proj-1",
    docsOrigins: [DOCS],
    query: { origin: DOCS, state: STATE },
    ...options,
  });
}

async function press(name: string) {
  await userEvent.setup().click(screen.getByRole("button", { name }));
}

afterEach(() => cleanup());

describe("given a consent request from an origin that is not registered for docs", () => {
  /** @scenario "The consent page refuses an unregistered docs origin" */
  it("explains the site cannot connect and offers no way to mint", () => {
    for (const origin of ["https://evil.example", "https://langwatch.ai.evil.example"]) {
      const host = hostWith({ query: { origin, state: STATE } });
      renderWithAuthorizeHost(<DocsConnect />, host);

      expect(screen.getByText("This site can't connect to LangWatch")).toBeInTheDocument();
      expect(screen.getByText(/not registered to connect/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Allow" })).toBeNull();
      expect(host.docsMints).toEqual([]);
      expect(host.posted).toEqual([]);
      cleanup();
    }
  });

  it("refuses a state that is not 43 base64url characters", () => {
    const host = hostWith({ query: { origin: DOCS, state: "short" } });
    renderWithAuthorizeHost(<DocsConnect />, host);

    expect(screen.getByText(/link that opened this page is incomplete/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Allow" })).toBeNull();
  });

  it("refuses a page nobody opened as a popup", () => {
    const host = hostWith({ hasOpener: false });
    renderWithAuthorizeHost(<DocsConnect />, host);

    expect(screen.getByText(/Use my LangWatch account/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Allow" })).toBeNull();
  });
});

describe("given an operator impersonating a member", () => {
  /** @scenario "No docs session key is minted while an operator acts as another member" */
  it("refuses before any mint is asked", () => {
    const host = hostWith({ impersonated: true });
    renderWithAuthorizeHost(<DocsConnect />, host);

    expect(screen.getByText(/acting as another member/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Allow" })).toBeNull();
    expect(host.docsMints).toEqual([]);
  });
});

describe("given the consent page is open", () => {
  /** @scenario "A member who denies access mints nothing" */
  it("tells the docs the request was denied, at their exact origin, and mints nothing", async () => {
    const host = hostWith();
    renderWithAuthorizeHost(<DocsConnect />, host);

    await press("Deny");

    expect(host.docsMints).toEqual([]);
    expect(host.posted).toEqual([
      {
        message: { type: "langwatch:docs-session", version: 1, state: STATE, outcome: "denied" },
        targetOrigin: DOCS,
      },
    ]);
    expect(host.closed).toBe(1);
  });

  it("hands the minted key to the docs' exact origin on Allow, then closes", async () => {
    const host = hostWith();
    renderWithAuthorizeHost(<DocsConnect />, host);
    expect(screen.getByText(/anything you can do in this project/)).toBeInTheDocument();
    expect(screen.getByText(/5 minutes/)).toBeInTheDocument();

    await press("Allow");

    await waitFor(() => expect(host.closed).toBe(1));
    expect(host.docsMints).toEqual([{ projectId: "proj-1", docsOrigin: DOCS }]);
    expect(host.posted).toEqual([
      {
        message: {
          type: "langwatch:docs-session",
          version: 1,
          state: STATE,
          outcome: "granted",
          token: "sk-lw-docs",
          expiresAt: "2026-10-26T12:05:00.000Z",
          expiresIn: 300,
          project: { id: "proj-1", name: "Checkout" },
        },
        targetOrigin: DOCS,
      },
    ]);
  });

  it("posts nothing and stays open when the mint is refused", async () => {
    const host = hostWith({ docsKey: new Error("refused") });
    renderWithAuthorizeHost(<DocsConnect />, host);

    await press("Allow");

    await waitFor(() => expect(host.failures).toHaveLength(1));
    expect(host.posted).toEqual([]);
    expect(host.closed).toBe(0);
  });
});

describe("given a signed-out reader", () => {
  it("sends them to sign in and back to this request", () => {
    const host = hostWith({ status: "unauthenticated" });
    renderWithAuthorizeHost(<DocsConnect />, host);

    const callback = `/connect/docs?origin=${encodeURIComponent(DOCS)}&state=${STATE}`;
    expect(host.moves).toEqual([
      { kind: "replace", to: `/auth/signin?callbackUrl=${encodeURIComponent(callback)}` },
    ]);
  });
});
