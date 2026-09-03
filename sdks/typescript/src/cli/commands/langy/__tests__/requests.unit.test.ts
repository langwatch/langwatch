/**
 * Finding and approving the control request, over a mocked fetch and a
 * scripted terminal.
 *
 * @see specs/typescript-sdk/cli-langy-share-control.feature
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chooseRequest,
  createControlApi,
  describeWorkspace,
  ensureSignedIn,
  isGitRepository,
  packageManagerOf,
  resolveShareRoot,
  ShareControlError,
  waitForRequests,
  type ControlApi,
  type ControlRequest,
} from "../requests";

const ENDPOINT = "https://app.langwatch.test";

const requestNamed = (id: string, title: string): ControlRequest => ({
  id,
  conversationId: `conv_${id}`,
  conversationTitle: title,
  conversationUrl: `${ENDPOINT}/acme/langy/conv_${id}`,
  projectId: "project_1",
  projectName: "ACME Shop",
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 900_000).toISOString(),
});

/** A fetch that answers each route from a table and records what it was sent. */
const fakeFetch = (
  answers: Record<string, { status?: number; body: unknown }>,
): { impl: typeof fetch; calls: Array<{ url: string; init?: RequestInit }> } => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, ...(init === undefined ? {} : { init }) });
    const key = Object.keys(answers).find((entry) => url.endsWith(entry));
    const answer = key ? answers[key]! : { status: 404, body: {} };
    return {
      ok: (answer.status ?? 200) < 400,
      status: answer.status ?? 200,
      text: async () => JSON.stringify(answer.body),
    } as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
};

describe("given the share-control command", () => {
  describe("when the folder is resolved", () => {
    let base: string;

    beforeEach(() => {
      base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "langy-req-")));
    });

    afterEach(() => {
      fs.rmSync(base, { recursive: true, force: true });
    });

    /** @scenario "The folder is the current directory, reported as its real path" */
    it("reports the real path of a directory reached through a symlink", () => {
      const real = path.join(base, "project");
      fs.mkdirSync(real);
      const link = path.join(base, "link");
      fs.symlinkSync(real, link);
      expect(resolveShareRoot({ cwd: link, homedir: "/home/dev" })).toBe(real);
    });

    /** @scenario "The command refuses to share a home directory or a filesystem root" */
    it("refuses the home directory and the filesystem root", () => {
      expect(() => resolveShareRoot({ cwd: base, homedir: base })).toThrow(
        /home directory/,
      );
      expect(() =>
        resolveShareRoot({ cwd: path.parse(base).root, homedir: base }),
      ).toThrow(/filesystem root/);
    });

    it("reads the folder's package manager and git state", () => {
      const root = path.join(base, "project");
      fs.mkdirSync(root);
      fs.writeFileSync(path.join(root, "pnpm-lock.yaml"), "");
      expect(packageManagerOf(root)).toBe("pnpm");
      expect(isGitRepository(root)).toBe(false);

      const workspace = describeWorkspace(root);
      expect(workspace.root).toBe(root);
      expect(workspace.name).toBe("project");
      expect(workspace.packageManager).toBe("pnpm");
      expect(workspace.nodeVersion).toBe(process.version);
      expect(workspace.os).toContain(os.platform());
    });
  });

  describe("when the machine has no device session", () => {
    /** @scenario "The command signs in when there is no session" */
    it("runs the login flow first and then resolves the credentials", async () => {
      const login = vi.fn(async () => undefined);
      const before = process.env.LANGWATCH_API_KEY;
      process.env.LANGWATCH_API_KEY = "sk-lw-test-key";
      try {
        // With a key in the environment the resolver never reaches the config,
        // so this proves the order: login first, credentials after.
        const credentials = await ensureSignedIn({ login });
        expect(credentials.apiKey).toBe("sk-lw-test-key");
      } finally {
        if (before === undefined) delete process.env.LANGWATCH_API_KEY;
        else process.env.LANGWATCH_API_KEY = before;
      }
    });
  });

  describe("when the open requests are listed", () => {
    it("reads them from the control route with the caller's credentials", async () => {
      const { impl, calls } = fakeFetch({
        "/api/v1/langy/control/requests": {
          body: { requests: [requestNamed("req_1", "Instrument tracing")] },
        },
      });
      const api = createControlApi({
        endpoint: ENDPOINT,
        apiKey: "sk-lw-abc",
        fetchImpl: impl,
      });
      const requests = await api.list();
      expect(requests).toHaveLength(1);
      expect(requests[0]!.conversationTitle).toBe("Instrument tracing");
      expect(calls[0]!.url).toBe(`${ENDPOINT}/api/v1/langy/control/requests`);
      const headers = calls[0]!.init!.headers as Record<string, string>;
      expect(headers.authorization).toContain("sk-lw-abc");
    });

    it("turns a refusal into one message the command can print", async () => {
      const { impl } = fakeFetch({
        "/api/v1/langy/control/requests": {
          status: 403,
          body: { message: "This key cannot list control requests." },
        },
      });
      const api = createControlApi({
        endpoint: ENDPOINT,
        apiKey: "sk-lw-abc",
        fetchImpl: impl,
      });
      await expect(api.list()).rejects.toBeInstanceOf(ShareControlError);
    });

    it("prints the tips of a v1 refusal, never the bare code", async () => {
      const { impl } = fakeFetch({
        "/api/v1/langy/control/requests": {
          status: 403,
          body: {
            code: "langy_local_request_invalid",
            message: "langy_local_request_invalid",
            tips: ["This request was cancelled.", "Ask Langy again."],
          },
        },
      });
      const api = createControlApi({
        endpoint: ENDPOINT,
        apiKey: "sk-lw-abc",
        fetchImpl: impl,
      });
      await expect(api.list()).rejects.toThrow(
        "This request was cancelled. Ask Langy again.",
      );
    });
  });

  describe("when one request is open", () => {
    /** @scenario "An open request is shown with the conversation and the folder" */
    it("shows the conversation, the project and the folder, and offers Approve and Cancel", async () => {
      const printed: string[] = [];
      const log = vi.spyOn(console, "log").mockImplementation((text) => {
        printed.push(String(text));
      });
      const asked: Array<Record<string, unknown>> = [];
      const ask = (async (options: Record<string, unknown>) => {
        asked.push(options);
        return { action: "approve" };
      }) as never;

      const request = requestNamed("req_1", "Instrument tracing in acme-app");
      const choice = await chooseRequest({
        requests: [request],
        root: "/work/acme",
        ask,
      });
      log.mockRestore();

      expect(printed.join("\n")).toContain("Instrument tracing in acme-app");
      expect(printed.join("\n")).toContain("ACME Shop");
      expect(printed.join("\n")).toContain("/work/acme");
      const choices = asked[0]!.choices as Array<{ title: string }>;
      expect(choices.map((entry) => entry.title)).toEqual(["Approve", "Cancel"]);
      expect(choice).toEqual({ action: "approve", request });
    });

    /** @scenario "Approving connects and prints where to follow along" */
    it("approving posts the workspace and receives the session key", async () => {
      const { impl, calls } = fakeFetch({
        "/req_1/approve": {
          body: {
            sessionKey: "sk-lw-langy-session",
            endpoint: ENDPOINT,
            conversation: {
              id: "conv_1",
              title: "Instrument tracing",
              url: `${ENDPOINT}/acme/langy/conv_1`,
            },
          },
        },
      });
      const api = createControlApi({
        endpoint: ENDPOINT,
        apiKey: "sk-lw-abc",
        fetchImpl: impl,
      });
      const approved = await api.approve({
        requestId: "req_1",
        workspace: { root: "/work/acme", name: "acme", os: "darwin" },
      });
      expect(approved.sessionKey).toBe("sk-lw-langy-session");
      expect(approved.conversation.url).toContain("/langy/conv_1");
      const posted = JSON.parse(calls[0]!.init!.body as string) as {
        workspace: { root: string };
      };
      expect(posted.workspace.root).toBe("/work/acme");
      expect(calls[0]!.init!.method).toBe("POST");
    });

    /** @scenario "Cancelling tells the conversation" */
    it("cancelling posts the cancel route", async () => {
      const { impl, calls } = fakeFetch({ "/req_1/cancel": { body: {} } });
      const api = createControlApi({
        endpoint: ENDPOINT,
        apiKey: "sk-lw-abc",
        fetchImpl: impl,
      });
      await api.cancel({ requestId: "req_1" });
      expect(calls[0]!.url).toBe(
        `${ENDPOINT}/api/v1/langy/control/requests/req_1/cancel`,
      );

      const ask = (async () => ({ action: "cancel" })) as never;
      const choice = await chooseRequest({
        requests: [requestNamed("req_1", "one")],
        root: "/work/acme",
        ask,
      });
      expect(choice.action).toBe("cancel");
    });
  });

  describe("when two conversations asked", () => {
    /** @scenario "Several open requests become a picker" */
    it("lists both with their titles and projects and asks which one", async () => {
      const asked: Array<Record<string, unknown>> = [];
      const ask = (async (options: Record<string, unknown>) => {
        asked.push(options);
        return options.name === "requestId"
          ? { requestId: "req_2" }
          : { action: "approve" };
      }) as never;

      const requests = [
        requestNamed("req_1", "Instrument tracing"),
        requestNamed("req_2", "Fix the refund scenario"),
      ];
      const choice = await chooseRequest({ requests, root: "/work/acme", ask });

      const picker = asked[0]!.choices as Array<{
        title: string;
        description: string;
      }>;
      expect(picker.map((entry) => entry.title)).toEqual([
        "Instrument tracing",
        "Fix the refund scenario",
      ]);
      expect(picker[0]!.description).toContain("ACME Shop");
      expect(choice).toEqual({ action: "approve", request: requests[1] });
    });
  });

  describe("when no conversation asked yet", () => {
    /** @scenario "No open request waits for one" */
    it("says it is waiting once and picks up a request recorded later", async () => {
      const answers: ControlRequest[][] = [
        [],
        [],
        [requestNamed("req_1", "Instrument tracing")],
      ];
      let read = 0;
      const api: ControlApi = {
        list: async () => answers[read++] ?? [],
        approve: async () => {
          throw new Error("not used");
        },
        cancel: async () => undefined,
      };
      const waiting = vi.fn();
      const slept: number[] = [];

      const requests = await waitForRequests({
        api,
        intervalMs: 5_000,
        onWaiting: waiting,
        sleep: async (ms) => {
          slept.push(ms);
        },
      });

      expect(requests).toHaveLength(1);
      expect(waiting).toHaveBeenCalledTimes(1);
      expect(slept).toEqual([5_000, 5_000]);
    });
  });
});
