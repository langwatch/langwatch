/**
 * @vitest-environment jsdom
 * Pins where the MCP consent screen sends the reader: sign-in, allow, deny, and each refusal.
 */

import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { FakeAuthorizeHost, renderWithAuthorizeHost } from "../../../testing.tsx";
import McpAuthorize from "../mcp-authorize-screen.tsx";

const QUERY = {
  response_type: "code",
  client_id: "client-1",
  redirect_uri: "https://app.example/cb",
  state: "st-1",
  code_challenge: "chal",
  code_challenge_method: "S256",
};

function hostWith(options: ConstructorParameters<typeof FakeAuthorizeHost>[0]) {
  return new FakeAuthorizeHost({ projectId: "proj-1", query: QUERY, ...options });
}

async function press(name: string) {
  await userEvent.setup().click(screen.getByRole("button", { name }));
}

const failureLines = (host: FakeAuthorizeHost) => host.failures.map((f) => f.description);

afterEach(() => cleanup());

describe("given a signed-out reader", () => {
  it("sends them to sign in carrying every non-empty OAuth parameter", () => {
    const host = hostWith({ status: "unauthenticated" });
    renderWithAuthorizeHost(<McpAuthorize />, host);
    const callback =
      "/mcp/authorize?response_type=code&client_id=client-1&redirect_uri=https%3A%2F%2Fapp.example%2Fcb&state=st-1&code_challenge=chal&code_challenge_method=S256";
    expect(host.moves).toEqual([
      { kind: "replace", to: `/auth/signin?callbackUrl=${encodeURIComponent(callback)}` },
    ]);
    expect(screen.queryByText("Allow")).toBeNull();
  });
});

describe("given a signed-in reader", () => {
  describe("when they allow", () => {
    it("forwards the request and hands off to an allowed redirect", async () => {
      const host = hostWith({ answer: { ok: true, redirect: "https://app.example/cb?code=1" } });
      renderWithAuthorizeHost(<McpAuthorize />, host);
      expect(screen.getByText("Scopes: mcp:tools")).toBeInTheDocument();
      await press("Allow");
      await waitFor(() => expect(host.moves).toHaveLength(1));
      expect(host.requests).toEqual([
        {
          projectId: "proj-1",
          redirect_uri: "https://app.example/cb",
          state: "st-1",
          code_challenge: "chal",
          code_challenge_method: "S256",
          client_id: "client-1",
        },
      ]);
      expect(host.moves).toEqual([{ kind: "handOff", to: "https://app.example/cb?code=1" }]);
    });

    it.each([
      [
        { ok: true, redirect: "javascript:alert(1)" },
        "The application asked to return to an unusable address",
      ],
      [{ ok: false, error: "invalid_request", error_description: "Bad PKCE" }, "Bad PKCE"],
      [{ ok: false, error: "invalid_request" }, "invalid_request"],
      [{ ok: false }, "Unknown error"],
      [{ ok: true }, "No redirect URL received from server"],
      [new Error("socket closed"), "socket closed"],
    ])("refuses on the screen for %o", async (answer, line) => {
      const host = hostWith({ answer });
      renderWithAuthorizeHost(<McpAuthorize />, host);
      await press("Allow");
      await waitFor(() => expect(failureLines(host)).toEqual([line]));
      expect(host.moves).toEqual([]);
    });
  });

  describe("when they deny", () => {
    it("returns access_denied and the state to an allowed redirect", async () => {
      const host = hostWith({});
      renderWithAuthorizeHost(<McpAuthorize />, host);
      await press("Deny");
      expect(host.moves).toEqual([
        { kind: "handOff", to: "https://app.example/cb?error=access_denied&state=st-1" },
      ]);
    });

    it.each([
      ["an unusable redirect", { ...QUERY, redirect_uri: "javascript:alert(1)" }],
      ["no redirect", { ...QUERY, redirect_uri: undefined }],
    ])("goes home when there is %s", async (_label, query) => {
      const host = hostWith({ query });
      renderWithAuthorizeHost(<McpAuthorize />, host);
      await press("Deny");
      expect(host.moves).toEqual([{ kind: "navigate", to: "/" }]);
    });

    it("omits the state when none was sent", async () => {
      const host = hostWith({ query: { ...QUERY, state: undefined } });
      renderWithAuthorizeHost(<McpAuthorize />, host);
      await press("Deny");
      expect(host.moves).toEqual([
        { kind: "handOff", to: "https://app.example/cb?error=access_denied" },
      ]);
    });
  });
});
