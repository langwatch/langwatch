// @vitest-environment jsdom
import { ToastProvider } from "@langwatch/design-system-internal";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { stubDaemon, type DaemonReply } from "../../__fixtures__/daemon-fetch.ts";
import { liveHome, notFound, stoppedHome, surfacesFor } from "../../__fixtures__/daemon.ts";
import { msOf } from "../../shared/clock.ts";
import type { StackHome } from "../../shared/contract.ts";
import { StackHomeApp } from "../stack-home-app.tsx";

const NOW = msOf({ iso: "2026-09-28T12:00:00Z" });

const serve = ({
  home,
  others = () => undefined,
}: {
  home: () => StackHome;
  others?: (path: string) => DaemonReply | undefined;
}) =>
  stubDaemon({
    answer: ({ method, path }) => {
      if (method === "GET" && path === `/api/stacks/${home().slug}`) return { body: home() };
      if (method === "GET" && path.startsWith("/api/stacks/")) {
        return { status: 404, body: notFound({ slug: path.split("/").at(-1) ?? "" }) };
      }
      return others(path);
    },
  });

const openHome = async ({ slug }: { slug: string }) => {
  render(
    <ToastProvider>
      <StackHomeApp slug={slug} />
    </ToastProvider>,
  );
  return screen.findByRole("heading", { name: "Surfaces" });
};

const surfaceRow = ({ name }: { name: string }) => {
  const table = screen.getByRole("table", { name: "Surfaces of this stack" });
  const row = within(table)
    .getAllByRole("row")
    .find((candidate) => within(candidate).queryByRole("cell", { name }) !== null);
  if (row === undefined) throw new Error(`no surface row for ${name}`);
  return row;
};

describe("StackHome", () => {
  const writeText = vi.fn((_text: string) => Promise.resolve());
  beforeEach(() => {
    writeText.mockClear();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    // jsdom has no modal dialogs; open and close are what the page reads.
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function close() {
      this.open = false;
    };
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  describe("when the stack is live", () => {
    /** @scenario "Every surface of the stack is listed with live status" */
    it("lists every surface with its status, hostname and port, and how to turn on the unselected", async () => {
      serve({ home: () => liveHome({ now: NOW }) });
      await openHome({ slug: "feat-x" });

      for (const name of [
        "app",
        "api",
        "worker",
        "gateway",
        "nlp",
        "langyagent",
        "idp",
        "mail",
        "design-system",
        "mail-room",
      ]) {
        expect(surfaceRow({ name })).toBeDefined();
      }
      expect(within(surfaceRow({ name: "app" })).getByText("Live")).toBeDefined();
      expect(
        within(surfaceRow({ name: "app" })).getByRole("link", {
          name: "app.feat-x.langwatch.localhost",
        }),
      ).toBeDefined();
      expect(within(surfaceRow({ name: "app" })).getByText("5560")).toBeDefined();
      expect(within(surfaceRow({ name: "worker" })).getByText("Starting")).toBeDefined();
      expect(
        within(surfaceRow({ name: "worker" })).getByText("waiting for :9464 to answer"),
      ).toBeDefined();
      expect(within(surfaceRow({ name: "nlp" })).getByText("Down")).toBeDefined();
      const langy = surfaceRow({ name: "langyagent" });
      expect(within(langy).getByText("Not selected")).toBeDefined();
      expect(
        within(langy).getByText("not part of this stack; start it with haven up +langy"),
      ).toBeDefined();
    });
  });

  describe("when the stack's launcher is not running", () => {
    /** @scenario "The home answers while the stack is down" */
    it("shows every surface down and offers a start that names the worktree", async () => {
      const home = stoppedHome({ now: NOW });
      const daemon = serve({
        home: () => home,
        others: (path) =>
          path === "/api/worktrees/start" ? { body: { message: "starting stopped" } } : undefined,
      });
      await openHome({ slug: "stopped" });

      const table = screen.getByRole("table", { name: "Surfaces of this stack" });
      const statuses = within(table)
        .getAllByRole("row")
        .slice(1)
        .map((row) => within(row).getAllByRole("cell")[0]?.textContent);
      expect(statuses).toHaveLength(home.surfaces.length);
      expect(new Set(statuses)).toEqual(new Set(["Down"]));

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Start" }));
      });
      expect(daemon.calls).toContainEqual({
        method: "POST",
        path: "/api/worktrees/start",
        body: { dir: home.facts.worktreeDir },
      });
    });
  });

  describe("when restart is pressed", () => {
    /** @scenario "Restarting from the home asks for a confirming second click" */
    it("waits for a second press, restarts, then shows the surfaces starting and then live", async () => {
      let phase: "live" | "starting" | "back" = "live";
      const home = () =>
        phase === "starting"
          ? liveHome({ now: NOW, surfaces: surfacesFor({ slug: "feat-x", status: "starting" }) })
          : liveHome({ now: NOW });
      const daemon = serve({
        home,
        others: (path) => {
          if (path !== "/api/stacks/feat-x/restart") return undefined;
          phase = "starting";
          return { body: { message: "restarted feat-x" } };
        },
      });
      await openHome({ slug: "feat-x" });

      fireEvent.click(screen.getByRole("button", { name: "Restart" }));
      expect(daemon.calls.some((call) => call.method === "POST")).toBe(false);

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Restart?" }));
      });
      expect(daemon.calls).toContainEqual({
        method: "POST",
        path: "/api/stacks/feat-x/restart",
        body: undefined,
      });
      expect(await within(surfaceRow({ name: "app" })).findByText("Starting")).toBeDefined();

      phase = "back";
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(await within(surfaceRow({ name: "app" })).findByText("Live")).toBeDefined();
    });
  });

  describe("when a service is not selected", () => {
    /** @scenario "A service the stack does not run is started from its row" */
    it("starts it from its row after a confirming second press", async () => {
      const daemon = serve({
        home: () => liveHome({ now: NOW }),
        others: (path) =>
          path === "/api/stacks/feat-x/start-service?service=mail-room"
            ? { body: { message: "restarting feat-x with mail-room" } }
            : undefined,
      });
      await openHome({ slug: "feat-x" });

      const row = surfaceRow({ name: "mail-room" });
      fireEvent.click(within(row).getByRole("button", { name: "Start" }));
      expect(daemon.calls.some((call) => call.method === "POST")).toBe(false);

      await act(async () => {
        fireEvent.click(within(row).getByRole("button", { name: "Start mail-room?" }));
      });
      expect(daemon.calls).toContainEqual({
        method: "POST",
        path: "/api/stacks/feat-x/start-service?service=mail-room",
        body: undefined,
      });
    });
  });

  describe("when the upgrade floor holds the api", () => {
    const message = "this installation is on 3.19.3; upgrade to 3.20.1 (LTS) first";
    /** @scenario "A stack whose database is below the upgrade floor can reset its databases from the stack home" */
    it("says so and resets the databases once the database name is typed", async () => {
      const daemon = serve({
        home: () => ({ ...liveHome({ now: NOW }), belowFloor: message }),
        others: (path) =>
          path === "/api/stacks/feat-x/reset-databases"
            ? { body: { message: "resetting feat-x's databases" } }
            : undefined,
      });
      await openHome({ slug: "feat-x" });

      expect(screen.getByText(message, { exact: false })).toBeDefined();
      fireEvent.click(screen.getByRole("button", { name: "Reset databases" }));
      const dialog = await screen.findByRole("dialog");
      const confirm = within(dialog).getByRole("button", { name: "Reset databases" });
      expect(confirm.hasAttribute("disabled")).toBe(true);

      const database = liveHome({ now: NOW }).facts.databases.postgres.name;
      fireEvent.change(within(dialog).getByLabelText(`Type ${database} to confirm`), {
        target: { value: database },
      });
      await act(async () => {
        fireEvent.click(within(dialog).getByRole("button", { name: "Reset databases" }));
      });
      expect(daemon.calls).toContainEqual({
        method: "POST",
        path: "/api/stacks/feat-x/reset-databases",
        body: { confirm: database },
      });
    });

    it("shows no callout when nothing holds the api", async () => {
      serve({ home: () => liveHome({ now: NOW }) });
      await openHome({ slug: "feat-x" });
      expect(screen.queryByRole("button", { name: "Reset databases" })).toBeNull();
    });
  });

  describe("when lanes logged errors", () => {
    /** @scenario "Recent errors link into the logs" */
    it("shows each lane's errors newest first, each lane linking to the hub's log view", async () => {
      serve({ home: () => liveHome({ now: NOW }) });
      await openHome({ slug: "feat-x" });

      const api = screen.getByRole("table", { name: "Recent errors in api" });
      const messages = within(api)
        .getAllByRole("row")
        .slice(1)
        .map((row) => within(row).getAllByRole("cell").at(-1)?.textContent ?? "");
      expect(messages[0]).toContain("request failed");
      expect(messages[1]).toContain("timed out");
      const links = screen
        .getAllByRole("link", { name: "Open in logs" })
        .map((link) => link.getAttribute("href"));
      expect(links).toEqual([
        "https://hub.langwatch.localhost/logs/feat-x/api",
        "https://hub.langwatch.localhost/logs/feat-x/worker",
      ]);
    });
  });

  describe("when the credentials are drawn", () => {
    /** @scenario "Dev credentials are shown without printing secrets" */
    it("shows the login, mail address and IdP tenants, and copies the API key without printing it", async () => {
      const daemon = serve({
        home: () => liveHome({ now: NOW }),
        others: (path) =>
          path === "/api/stacks/feat-x/api-key"
            ? { body: { apiKey: "sk-lw-the-whole-key-9f3a" } }
            : undefined,
      });
      await openHome({ slug: "feat-x" });

      expect(screen.getByText("admin@langwatch.localhost")).toBeDefined();
      expect(screen.getByText("feat-x@mail.langwatch.localhost")).toBeDefined();
      expect(
        screen.getByRole("link", { name: "https://idp.feat-x.langwatch.localhost/acme" }),
      ).toBeDefined();
      expect(screen.getByText("sk-lw-••••••••9f3a")).toBeDefined();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Copy API key" }));
      });
      expect(daemon.calls).toContainEqual({
        method: "POST",
        path: "/api/stacks/feat-x/api-key",
        body: undefined,
      });
      expect(writeText).toHaveBeenCalledWith("sk-lw-the-whole-key-9f3a");
      expect(document.body.textContent).not.toContain("sk-lw-the-whole-key-9f3a");
    });
  });

  describe("when the facts are drawn", () => {
    /** @scenario "Stack facts" */
    it("shows the branch, worktree, layout, uptime, memory and the three databases", async () => {
      serve({ home: () => liveHome({ now: NOW }) });
      await openHome({ slug: "feat-x" });

      const facts = screen.getByRole("region", { name: "Facts" });
      for (const text of [
        "feat/feat-x-stack-home",
        "/Users/someone/Source/github.com/langwatch/langwatch/.worktrees/feat-x",
        "modular",
        "4h 12m",
        "3.4 GB",
        "lw_feat_x :5432",
        "lw_feat_x :8123",
        "db 3 :6379",
      ]) {
        expect(within(facts).getByText(text)).toBeDefined();
      }
    });
  });

  describe("when a seed is started from the seed panel", () => {
    /** @scenario "The stack home seeds a stack at a chosen size and shows its progress" */
    it("starts haven seed at the chosen size and persona and shows the run's log", async () => {
      const running = {
        ...liveHome({ now: NOW }),
        seed: {
          ...liveHome({ now: NOW }).seed,
          status: "seed: running for 12s [--size small --persona startup]",
          log: ["planning run r1", "orgs 3/6"],
        },
      };
      let seeded = false;
      const daemon = serve({
        home: () => (seeded ? running : liveHome({ now: NOW })),
        others: (path) => {
          if (path !== "/api/stacks/feat-x/seed") return undefined;
          seeded = true;
          return { body: { message: "seeding feat-x at the small size" } };
        },
      });
      await openHome({ slug: "feat-x" });

      fireEvent.change(screen.getByLabelText("Size"), { target: { value: "small" } });
      fireEvent.change(screen.getByLabelText("Persona"), { target: { value: "startup" } });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Seed" }));
      });
      expect(daemon.calls).toContainEqual({
        method: "POST",
        path: "/api/stacks/feat-x/seed",
        body: { size: "small", persona: "startup" },
      });
      expect(await screen.findByText("orgs 3/6", { exact: false })).toBeDefined();
      expect(screen.getByRole("button", { name: "Seed" }).hasAttribute("disabled")).toBe(true);
    });
  });

  describe("when the slug is unknown", () => {
    it("says no stack is registered and links the hub", async () => {
      serve({ home: () => liveHome({ now: NOW }) });
      render(
        <ToastProvider>
          <StackHomeApp slug="nope" />
        </ToastProvider>,
      );
      expect(await screen.findByText("No stack is registered for “nope”")).toBeDefined();
      expect(screen.getByRole("link", { name: "Open the hub" }).getAttribute("href")).toBe(
        "https://hub.langwatch.localhost",
      );
    });
  });
});
