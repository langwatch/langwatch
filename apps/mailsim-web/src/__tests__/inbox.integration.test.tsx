// @vitest-environment jsdom
import { ToastProvider } from "@langwatch/design-system-internal";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Inbox } from "../inbox.tsx";

const summaries = [
  {
    id: "01B",
    from: "no-reply@langwatch.localhost",
    to: ["alex+invite@example.test"],
    subject: "You are invited",
    receivedAt: "2026-09-28T10:01:00Z",
    sizeBytes: 900,
  },
  {
    id: "01A",
    from: "no-reply@langwatch.localhost",
    to: ["admin@mail.langwatch.localhost"],
    subject: "Welcome",
    receivedAt: "2026-09-28T10:00:00Z",
    sizeBytes: 300,
  },
];

const invite = {
  ...summaries[0],
  headers: { Subject: "You are invited" },
  text: "Accept at https://app.local/accept.",
  html: "<p>Accept</p>",
  links: ["https://app.local/accept"],
  attachments: null,
};

const inbox = {
  stack: "feature-one",
  smtpAddr: "127.0.0.1:5581",
  baseUrl: "https://mail.feature-one.langwatch.localhost:1355",
  persistent: true,
};

const json = ({ body, status = 200 }: { body: unknown; status?: number }) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** The sink's API as the inbox calls it; the long poll parks until the test ends. */
const fakeSink = () => {
  const calls: string[] = [];
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push(`${method} ${input}`);
    if (input.startsWith("/api/messages/wait")) {
      return new Promise<Response>((_, refuse) => {
        init?.signal?.addEventListener("abort", () => refuse(new Error("aborted")));
      });
    }
    if (method === "DELETE") return new Response(null, { status: 204 });
    if (input === "/api/inbox") return json({ body: inbox });
    if (input === "/api/messages") return json({ body: { messages: summaries } });
    if (input === "/api/messages/01B") return json({ body: invite });
    return json({ body: { error: "not_found" }, status: 404 });
  });
  vi.stubGlobal("fetch", fetch);
  return { calls };
};

const renderInbox = ({ path = "/" }: { path?: string } = {}) => {
  window.history.replaceState(null, "", path);
  return render(
    <ToastProvider>
      <Inbox />
    </ToastProvider>,
  );
};

describe("the browser inbox", () => {
  const requestPermission = vi.fn(async () => "granted");

  beforeEach(() => {
    const Notification = Object.assign(vi.fn(), { permission: "default", requestPermission });
    vi.stubGlobal("Notification", Notification);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    requestPermission.mockClear();
    window.localStorage.clear();
  });

  describe("when the stack's mail hostname is opened", () => {
    /** @scenario "The inbox is served in the browser at the stack's mail hostname" */
    it("lists the caught messages, and opening one renders its HTML body", async () => {
      fakeSink();
      renderInbox();

      const list = await screen.findByRole("list", { name: "Caught messages" });
      expect(within(list).getByText("You are invited")).toBeTruthy();
      expect(within(list).getByText("Welcome")).toBeTruthy();

      fireEvent.click(within(list).getByText("You are invited"));

      const preview = await screen.findByTitle("Email preview");
      expect(preview.getAttribute("src")).toBe("/api/messages/01B/html");
      expect(window.location.pathname).toBe("/messages/01B");
    });

    /** @scenario "The inbox is served in the browser at the stack's mail hostname" */
    it("opens the message a /messages/{id} link names", async () => {
      fakeSink();
      renderInbox({ path: "/messages/01B" });

      expect(await screen.findByTitle("Email preview")).toBeTruthy();
      expect(screen.getByRole("link", { name: /https:\/\/app\.local\/accept/u })).toBeTruthy();
    });
  });

  describe("when a message's HTML body is viewed", () => {
    /** @scenario "A caught message's HTML is rendered inert" */
    it("renders in a frame sandboxed to popups only", async () => {
      fakeSink();
      renderInbox({ path: "/messages/01B" });

      const preview = await screen.findByTitle("Email preview");
      expect(preview.getAttribute("sandbox")).toBe("allow-popups allow-popups-to-escape-sandbox");
    });
  });

  describe("when the inbox page is opened", () => {
    /** @scenario "Mail pages identify their stack and retain isolated inboxes" */
    it("names the stack, the SMTP listener and whether messages persist", async () => {
      fakeSink();
      renderInbox();

      expect(await screen.findByText("127.0.0.1:5581")).toBeTruthy();
      expect(screen.getAllByText("feature-one").length).toBeGreaterThan(0);
      expect(screen.getByText("Captured messages survive service restarts.")).toBeTruthy();
    });
  });

  describe("when desktop notifications are offered", () => {
    /** @scenario "The inbox can tell you a message arrived without you watching it" */
    it("starts off and asks for permission only when the toggle is pressed", async () => {
      fakeSink();
      renderInbox();

      const toggle = await screen.findByRole("button", { name: "Notify me" });
      expect(requestPermission).not.toHaveBeenCalled();

      fireEvent.click(toggle);

      await screen.findByRole("button", { name: "Notifying" });
      expect(requestPermission).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the inbox is cleared", () => {
    it("deletes every message only after the second press", async () => {
      const { calls } = fakeSink();
      renderInbox();
      await screen.findByRole("list", { name: "Caught messages" });

      fireEvent.click(screen.getByRole("button", { name: "Clear inbox" }));
      expect(calls).not.toContain("DELETE /api/messages");
      fireEvent.click(screen.getByRole("button", { name: "Clear all" }));

      await waitFor(() => expect(calls).toContain("DELETE /api/messages"));
    });
  });

  describe("when the inbox is searched", () => {
    it("shows only the matching messages", async () => {
      fakeSink();
      renderInbox();
      const list = await screen.findByRole("list", { name: "Caught messages" });

      fireEvent.change(screen.getByRole("searchbox", { name: "Search inbox" }), {
        target: { value: "welcome" },
      });

      await waitFor(() => expect(within(list).queryByText("You are invited")).toBeNull());
      expect(within(list).getByText("Welcome")).toBeTruthy();
    });
  });
});
