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

import { resolvePersonCredentials } from "../../../utils/apiKey";
import type { KeyEvent, KeySource } from "../approval";
import {
  chooseRequest,
  createControlApi,
  describeWorkspace,
  ensureSignedIn,
  isGitRepository,
  loginElsewhereMessage,
  packageManagerOf,
  platformTakesTheKey,
  resolveShareRoot,
  ShareControlError,
  SIGN_IN_FAILED_MESSAGE,
  waitForRequests,
  type ControlApi,
  type ControlRequest,
} from "../requests";
import type { UiWriter } from "../ui";

const ENDPOINT = "https://app.langwatch.test";

const ANSI_SEQUENCE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const stripAnsi = (text: string): string => text.replace(ANSI_SEQUENCE, "");

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
): { impl: typeof fetch; calls: { url: string; init?: RequestInit }[] } => {
  const calls: { url: string; init?: RequestInit }[] = [];
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
      expect(() => resolveShareRoot({ cwd: base, homedir: base })).toThrow(/home directory/);
      expect(() => resolveShareRoot({ cwd: path.parse(base).root, homedir: base })).toThrow(
        /filesystem root/,
      );
    });

    /** @scenario "A folder uv manages names uv as its package manager" */
    it("names uv for a lock file, a tool.uv table, or a virtual environment uv made", () => {
      const withLock = path.join(base, "with-lock");
      fs.mkdirSync(withLock);
      fs.writeFileSync(path.join(withLock, "package-lock.json"), "");
      fs.writeFileSync(path.join(withLock, "uv.lock"), "");
      expect(packageManagerOf(withLock)).toBe("uv");

      const withTable = path.join(base, "with-table");
      fs.mkdirSync(withTable);
      fs.writeFileSync(
        path.join(withTable, "pyproject.toml"),
        '[project]\nname = "acme"\n\n[tool.uv]\ndev-dependencies = []\n',
      );
      expect(packageManagerOf(withTable)).toBe("uv");

      // The r38 checkout: a pyproject with no uv table, no lock file, and a
      // venv uv made. Nothing else names a manager, and that venv has no pip.
      const withVenv = path.join(base, "with-venv");
      fs.mkdirSync(path.join(withVenv, ".venv"), { recursive: true });
      fs.writeFileSync(
        path.join(withVenv, "pyproject.toml"),
        '[project]\nname = "acme"\n\n[build-system]\nrequires = ["hatchling"]\n',
      );
      fs.writeFileSync(
        path.join(withVenv, ".venv", "pyvenv.cfg"),
        "home = /opt/python/bin\nimplementation = CPython\nuv = 0.10.12\nversion_info = 3.13.0\n",
      );
      expect(packageManagerOf(withVenv)).toBe("uv");

      const plainVenv = path.join(base, "plain-venv");
      fs.mkdirSync(path.join(plainVenv, ".venv"), { recursive: true });
      fs.writeFileSync(
        path.join(plainVenv, ".venv", "pyvenv.cfg"),
        "home = /opt/python/bin\nversion = 3.12.1\n",
      );
      fs.writeFileSync(path.join(plainVenv, "requirements.txt"), "");
      expect(packageManagerOf(plainVenv)).toBe("pip");
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
      expect(workspace.gitRepository).toBe(false);
      expect(workspace.gitBranch).toBeUndefined();
      expect(workspace.packageManager).toBe("pnpm");
      expect(workspace.nodeVersion).toBe(process.version);
      expect(workspace.os).toContain(os.platform());
    });
  });

  describe("when the command signs in", () => {
    const FOLDER_KEY = "sk-lw-folder-project-key";
    const ENV_FILE = `LANGWATCH_API_KEY=${FOLDER_KEY}\nOTHER_SECRET=stays\n`;

    let dir: string;
    let configPath: string;
    let envPath: string;
    let printed: string[];
    const before = {
      config: process.env.LANGWATCH_CLI_CONFIG,
      key: process.env.LANGWATCH_API_KEY,
      endpoint: process.env.LANGWATCH_ENDPOINT,
      cwd: process.cwd(),
    };

    const restoreEnv = (name: string, value: string | undefined): void => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };

    /** A login as Riley at ACME, with whatever a case changes about it. */
    const writeLogin = (overrides: Record<string, unknown> = {}): void => {
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          gateway_url: ENDPOINT,
          control_plane_url: ENDPOINT,
          access_token: "session-token",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          cli_api_key: "sk-lw-login-key",
          user: { id: "user_1", email: "riley@acme.test", name: "Riley" },
          organization: { id: "org_1", slug: "acme", name: "ACME" },
          personal_project: {
            id: "project_personal",
            slug: "riley-personal",
            api_key: "sk-lw-personal-key",
            validated_at: Math.floor(Date.now() / 1000),
          },
          ...overrides,
        }),
      );
    };

    /** The device login, standing in: it leaves a new login on the machine. */
    const loginThatSignsIn = () =>
      vi.fn(async () => {
        writeLogin({ cli_api_key: "sk-lw-new-login-key" });
      });

    beforeEach(() => {
      dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "langy-signin-")));
      configPath = path.join(dir, "home", "config.json");
      fs.mkdirSync(path.dirname(configPath));
      const folder = path.join(dir, "folder");
      fs.mkdirSync(folder);
      envPath = path.join(folder, ".env");
      fs.writeFileSync(envPath, ENV_FILE);
      process.chdir(folder);
      process.env.LANGWATCH_CLI_CONFIG = configPath;
      process.env.LANGWATCH_ENDPOINT = ENDPOINT;
      delete process.env.LANGWATCH_API_KEY;
      printed = [];
      vi.spyOn(console, "log").mockImplementation((text) => {
        printed.push(stripAnsi(String(text)));
      });
      vi.spyOn(console, "error").mockImplementation((text) => {
        printed.push(stripAnsi(String(text)));
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      process.chdir(before.cwd);
      restoreEnv("LANGWATCH_CLI_CONFIG", before.config);
      restoreEnv("LANGWATCH_API_KEY", before.key);
      restoreEnv("LANGWATCH_ENDPOINT", before.endpoint);
      fs.rmSync(dir, { recursive: true, force: true });
    });

    describe("given a login and a project key in the folder's .env", () => {
      /** @scenario "The login answers before a project key found in the folder" */
      /** @scenario "The command names the login it uses" */
      it("resolves the login's key on the personal project, never the folder's key", async () => {
        writeLogin();
        const login = loginThatSignsIn();

        const credentials = await ensureSignedIn({ login });

        expect(login).not.toHaveBeenCalled();
        expect(credentials.apiKey).toBe("sk-lw-login-key");
        expect(credentials.projectId).toBe("project_personal");
        expect(printed).toContain("Using your login as Riley at ACME.");
        const wrong = printed.filter(
          (line) =>
            line.includes("--project") ||
            line.includes("personal project") ||
            line.includes("API key"),
        );
        expect(wrong).toEqual([]);
      });

      /** @scenario "The folder's .env is left as it is" */
      it("leaves the folder's .env and the key in the environment as they were", async () => {
        writeLogin();

        await ensureSignedIn({ login: loginThatSignsIn() });

        expect(fs.readFileSync(envPath, "utf8")).toBe(ENV_FILE);
        expect(process.env.LANGWATCH_API_KEY).toBe(FOLDER_KEY);
      });
    });

    describe("given no login on the machine", () => {
      /** @scenario "The command signs in when there is no session" */
      it("runs the device login first and resolves the new login's key", async () => {
        const login = loginThatSignsIn();

        const credentials = await ensureSignedIn({ login });

        expect(login).toHaveBeenCalledTimes(1);
        expect(login).toHaveBeenCalledWith({ device: true });
        expect(credentials.apiKey).toBe("sk-lw-new-login-key");
        expect(printed).toContain("No login on this machine yet. Signing in first.");
        expect(printed).toContain("Using your login as Riley at ACME.");
      });

      /** @scenario "A key in the environment never stands in for the login" */
      it("signs in even with a key exported in the shell, and never resolves that key", async () => {
        process.env.LANGWATCH_API_KEY = "sk-lw-exported-in-the-shell";
        const login = loginThatSignsIn();
        const probed: string[] = [];

        const credentials = await ensureSignedIn({
          login,
          isAccepted: async ({ apiKey }) => {
            probed.push(apiKey);
            return true;
          },
        });

        expect(login).toHaveBeenCalledTimes(1);
        expect(credentials.apiKey).toBe("sk-lw-new-login-key");
        expect(probed).toEqual(["sk-lw-new-login-key"]);
        expect(process.env.LANGWATCH_API_KEY).toBe("sk-lw-exported-in-the-shell");
      });

      /** @scenario "The folder's .env is left as it is" */
      it("leaves the folder's .env as it was through a sign-in", async () => {
        await ensureSignedIn({ login: loginThatSignsIn() });

        expect(fs.readFileSync(envPath, "utf8")).toBe(ENV_FILE);
      });

      /** @scenario "A sign-in that leaves no usable login ends with what to run" */
      it("ends with what to run when the device login fails", async () => {
        const login = vi.fn(async () => {
          throw new Error("authorization request expired");
        });

        const failure = await ensureSignedIn({ login }).catch((e) => e);

        expect(failure).toBeInstanceOf(ShareControlError);
        expect((failure as Error).message).toBe(
          `${SIGN_IN_FAILED_MESSAGE} (authorization request expired)`,
        );
      });

      /** @scenario "A sign-in that leaves no usable login ends with what to run" */
      it("ends with what to run when the login leaves no login key", async () => {
        const login = vi.fn(async () => {
          writeLogin({ cli_api_key: undefined });
        });

        const failure = await ensureSignedIn({ login }).catch((e) => e);

        expect(login).toHaveBeenCalledTimes(1);
        expect(failure).toBeInstanceOf(ShareControlError);
        expect((failure as Error).message).toBe(SIGN_IN_FAILED_MESSAGE);
      });
    });

    describe("given a login that cannot be used", () => {
      const SIGNING_IN_AGAIN = "The login on this machine can no longer be used. Signing in again.";

      /** @scenario "A login that cannot be used signs in again" */
      it("signs in again when the login holds no login key, not falling to the folder's key", async () => {
        writeLogin({ cli_api_key: undefined });
        const login = loginThatSignsIn();

        const credentials = await ensureSignedIn({ login });

        expect(login).toHaveBeenCalledTimes(1);
        expect(credentials.apiKey).toBe("sk-lw-new-login-key");
        expect(printed).toContain(SIGNING_IN_AGAIN);
      });

      /** @scenario "A login that cannot be used signs in again" */
      it("signs in again when the server refuses the session", async () => {
        writeLogin({
          personal_project: {
            id: "project_personal",
            slug: "riley-personal",
            api_key: "sk-lw-personal-key",
            validated_at: 1,
          },
        });
        vi.stubGlobal(
          "fetch",
          vi.fn(
            async () =>
              new Response(JSON.stringify({ error: "unauthorized" }), {
                status: 401,
              }),
          ),
        );
        const login = loginThatSignsIn();

        const credentials = await ensureSignedIn({ login });

        expect(login).toHaveBeenCalledTimes(1);
        expect(credentials.apiKey).toBe("sk-lw-new-login-key");
        expect(printed).toContain(SIGNING_IN_AGAIN);
      });

      /** @scenario "A login that cannot be used signs in again" */
      it("signs in again when the platform turns the login's key down", async () => {
        writeLogin();
        const login = loginThatSignsIn();

        const credentials = await ensureSignedIn({
          login,
          isAccepted: async ({ apiKey }) => apiKey === "sk-lw-new-login-key",
        });

        expect(login).toHaveBeenCalledTimes(1);
        expect(credentials.apiKey).toBe("sk-lw-new-login-key");
        expect(printed).toContain(SIGNING_IN_AGAIN);
      });

      /** @scenario "A sign-in that leaves no usable login ends with what to run" */
      it("ends with what to run when the new login is turned down too", async () => {
        writeLogin();

        const failure = await ensureSignedIn({
          login: loginThatSignsIn(),
          isAccepted: async () => false,
        }).catch((e) => e);

        expect(failure).toBeInstanceOf(ShareControlError);
        expect((failure as Error).message).toBe(SIGN_IN_FAILED_MESSAGE);
      });
    });

    describe("given a login made against another address than the command targets", () => {
      const OTHER = "https://langwatch.other.test";

      /** @scenario "The login's key is never sent to another address than its own" */
      it("ends naming both addresses, sends no key and leaves the login alone", async () => {
        writeLogin();
        const loginBefore = fs.readFileSync(configPath, "utf8");
        fs.writeFileSync(envPath, `${ENV_FILE}LANGWATCH_ENDPOINT=${OTHER}\n`);
        delete process.env.LANGWATCH_ENDPOINT;
        const fetchSpy = vi.fn();
        vi.stubGlobal("fetch", fetchSpy);
        const login = loginThatSignsIn();
        const isAccepted = vi.fn(async () => true);

        const failure = await ensureSignedIn({ login, isAccepted }).catch((e) => e);

        expect(failure).toBeInstanceOf(ShareControlError);
        expect((failure as Error).message).toBe(
          loginElsewhereMessage({ loginEndpoint: ENDPOINT, endpoint: OTHER }),
        );
        expect((failure as Error).message).toContain("langwatch login --device");
        expect(isAccepted).not.toHaveBeenCalled();
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(login).not.toHaveBeenCalled();
        expect(fs.readFileSync(configPath, "utf8")).toBe(loginBefore);
      });

      /** @scenario "The login's key is never sent to another address than its own" */
      it("resolves no key for the other address, whoever asks", async () => {
        writeLogin();
        process.env.LANGWATCH_ENDPOINT = OTHER;

        expect(await resolvePersonCredentials()).toBeUndefined();
      });

      /** @scenario "Two spellings of one address are the same address" */
      it("reads a trailing slash and a capital letter as the same address", async () => {
        writeLogin();
        process.env.LANGWATCH_ENDPOINT = "https://APP.langwatch.test/";
        const login = loginThatSignsIn();

        const credentials = await ensureSignedIn({ login });

        expect(login).not.toHaveBeenCalled();
        expect(credentials.apiKey).toBe("sk-lw-login-key");
      });
    });
  });

  describe("when the platform is asked whether it takes the login's key", () => {
    const credentials = { endpoint: ENDPOINT, apiKey: "sk-lw-login-key" };

    /** @scenario "A login that cannot be used signs in again" */
    it("says no on a 401", async () => {
      const { impl } = fakeFetch({
        "/api/v1/langy/control/requests": {
          status: 401,
          body: { message: "Invalid API key" },
        },
      });
      expect(await platformTakesTheKey(credentials, { fetchImpl: impl })).toBe(false);
    });

    it("says yes when the list answers, and on a failure that is not about the key", async () => {
      const open = fakeFetch({
        "/api/v1/langy/control/requests": { body: { requests: [] } },
      });
      expect(await platformTakesTheKey(credentials, { fetchImpl: open.impl })).toBe(true);
      const down = fakeFetch({
        "/api/v1/langy/control/requests": { status: 503, body: {} },
      });
      expect(await platformTakesTheKey(credentials, { fetchImpl: down.impl })).toBe(true);
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
      await expect(api.list()).rejects.toThrow("This request was cancelled. Ask Langy again.");
    });

    /** @scenario "A refusal with several tips prints as sentences" */
    it("ends every tip with a stop before joining them", async () => {
      const { impl } = fakeFetch({
        "/api/v1/langy/control/requests": {
          status: 404,
          body: {
            code: "langy_local_request_invalid",
            message: "langy_local_request_invalid",
            tips: [
              "Only the person Langy asked can approve a request; ask Langy for the code change again to get your own",
              "A request is single use, so a second approval of the same one is refused",
            ],
          },
        },
      });
      const api = createControlApi({
        endpoint: ENDPOINT,
        apiKey: "sk-lw-abc",
        fetchImpl: impl,
      });
      await expect(api.list()).rejects.toThrow(
        "Only the person Langy asked can approve a request; ask Langy for the code change again to get your own. A request is single use, so a second approval of the same one is refused.",
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
      const asked: Record<string, unknown>[] = [];
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
      const choices = asked[0]!.choices as { title: string }[];
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
      expect(calls[0]!.url).toBe(`${ENDPOINT}/api/v1/langy/control/requests/req_1/cancel`);

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
      const asked: Record<string, unknown>[] = [];
      const ask = (async (options: Record<string, unknown>) => {
        asked.push(options);
        return options.name === "requestId" ? { requestId: "req_2" } : { action: "approve" };
      }) as never;

      // The picker lists the newest first, so the two need timestamps of their
      // own: built from the clock they land in the same millisecond most of the
      // time, and the run where they do not reverses the list.
      const now = Date.parse("2026-01-01T12:00:00.000Z");
      const requests = [
        {
          ...requestNamed("req_1", "Instrument tracing"),
          createdAt: new Date(now - 20_000).toISOString(),
        },
        {
          ...requestNamed("req_2", "Fix the refund scenario"),
          createdAt: new Date(now - 3 * 60_000).toISOString(),
        },
      ];
      const choice = await chooseRequest({
        requests,
        root: "/work/acme",
        ask,
        now,
      });

      const picker = asked[0]!.choices as {
        title: string;
        description: string;
      }[];
      expect(picker.map((entry) => entry.title)).toEqual([
        "Instrument tracing",
        "Fix the refund scenario",
      ]);
      expect(picker[0]!.description).toContain("ACME Shop");
      expect(choice).toEqual({ action: "approve", request: requests[1] });
    });

    /** @scenario "Several open requests become a picker" */
    it("says how long ago each conversation asked", async () => {
      const now = Date.parse("2026-01-01T12:00:00.000Z");
      const asked: Record<string, unknown>[] = [];
      const ask = (async (options: Record<string, unknown>) => {
        asked.push(options);
        return options.name === "requestId" ? { requestId: "req_1" } : { action: "approve" };
      }) as never;

      const requests = [
        {
          ...requestNamed("req_1", "Instrument tracing"),
          createdAt: new Date(now - 3 * 60_000).toISOString(),
        },
        {
          ...requestNamed("req_2", "Fix the refund scenario"),
          createdAt: new Date(now - 20_000).toISOString(),
        },
      ];
      await chooseRequest({ requests, root: "/work/acme", ask, now });

      const picker = asked[0]!.choices as { description: string }[];
      expect(picker[0]!.description).toBe("project ACME Shop, asked just now");
      expect(picker[1]!.description).toBe("project ACME Shop, asked 3 minutes ago");
    });
  });

  describe("when one conversation asked twice", () => {
    /** @scenario "One conversation is listed once" */
    it("keeps the newest request and never asks which one", async () => {
      const now = Date.parse("2026-01-01T12:00:00.000Z");
      const asked: Record<string, unknown>[] = [];
      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
      const ask = (async (options: Record<string, unknown>) => {
        asked.push(options);
        return { action: "approve" };
      }) as never;

      const older = {
        ...requestNamed("req_1", "Instrument tracing"),
        conversationId: "conv_same",
        createdAt: new Date(now - 5 * 60_000).toISOString(),
      };
      const newer = {
        ...requestNamed("req_2", "Instrument tracing"),
        conversationId: "conv_same",
        createdAt: new Date(now - 60_000).toISOString(),
      };
      const choice = await chooseRequest({
        requests: [older, newer],
        root: "/work/acme",
        ask,
        now,
      });
      log.mockRestore();

      expect(asked.map((entry) => entry.name)).toEqual(["action"]);
      expect(choice).toEqual({ action: "approve", request: newer });
    });
  });

  describe("when no conversation asked yet", () => {
    /** @scenario "No open request waits for one" */
    it("says it is waiting once and picks up a request recorded later", async () => {
      const answers: ControlRequest[][] = [[], [], [requestNamed("req_1", "Instrument tracing")]];
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

describe("given a terminal that can draw the question", () => {
  const ANSI_COLOURS = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
  const plain = (text: string): string => text.replace(ANSI_COLOURS, "");

  /** A screen that keeps the box and the lines, and a keyboard to answer with. */
  function boxScreen() {
    let drawn: string[] = [];
    const lines: string[] = [];
    let listener: ((key: KeyEvent) => void) | null = null;
    const writer: UiWriter = {
      line: (text) => {
        drawn = [];
        lines.push(plain(text));
      },
      draw: (block) => {
        drawn = block.map(plain);
      },
      erase: () => {
        drawn = [];
      },
      interactive: true,
    };
    const keys: KeySource = {
      listen: (onKey) => {
        listener = onKey;
        return () => {
          listener = null;
        };
      },
    };
    return {
      writer,
      keys,
      lines,
      get drawn() {
        return drawn;
      },
      press: (key: KeyEvent) => listener?.(key),
    };
  }

  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  describe("when one conversation asked for this folder", () => {
    /** @scenario "The request is asked in the same box as a permission question" */
    it("draws the folder, the conversation and the two answers", async () => {
      const screen = boxScreen();
      const request = requestNamed("req_1", "Instrument tracing in acme-app");

      const choice = chooseRequest({
        requests: [request],
        root: "/work/acme",
        writer: screen.writer,
        keys: screen.keys,
      });
      await settle();

      const box = screen.drawn
        .join(" ")
        .replace(/[│╭╮╰╯─]/g, " ")
        .replace(/\s+/g, " ");
      expect(screen.drawn[0]).toContain("Langy wants to work in acme");
      expect(box).toContain("Instrument tracing in acme-app");
      expect(box).toContain("Project ACME Shop");
      expect(box).toContain("/work/acme");
      expect(box).toContain("Do you want to share this folder?");
      expect(box).toContain("❯ 1. Share this folder with Langy");
      expect(box).toContain("2. Cancel this request");
      expect(box).toContain("Enter or a number to answer");

      screen.press({ name: "return" });
      await expect(choice).resolves.toEqual({ action: "approve", request });
      expect(screen.drawn).toEqual([]);
      expect(screen.lines.join("\n")).toContain(
        '⏺ Sharing this folder with "Instrument tracing in acme-app".',
      );
    });

    /** @scenario "The request is asked in the same box as a permission question" */
    it("cancels the request on the second option", async () => {
      const screen = boxScreen();
      const request = requestNamed("req_1", "Instrument tracing");

      const choice = chooseRequest({
        requests: [request],
        root: "/work/acme",
        writer: screen.writer,
        keys: screen.keys,
      });
      await settle();
      screen.press({ name: "2", sequence: "2" });

      await expect(choice).resolves.toEqual({ action: "cancel", request });
      expect(screen.drawn).toEqual([]);
    });

    it("leaves the request open on Escape", async () => {
      const screen = boxScreen();

      const choice = chooseRequest({
        requests: [requestNamed("req_1", "Instrument tracing")],
        root: "/work/acme",
        writer: screen.writer,
        keys: screen.keys,
      });
      await settle();
      screen.press({ name: "escape" });

      await expect(choice).resolves.toEqual({ action: "quit" });
      expect(screen.lines.join("\n")).toContain("The request stays open");
    });
  });

  describe("when two conversations asked for this folder", () => {
    /** @scenario "Several open requests become a picker" */
    it("picks one in the same box, then asks to share the folder", async () => {
      const screen = boxScreen();
      const first = {
        ...requestNamed("req_1", "Instrument tracing"),
        createdAt: new Date(Date.now() - 600_000).toISOString(),
      };
      const second = requestNamed("req_2", "Add a retry to the agent");

      const choice = chooseRequest({
        requests: [first, second],
        root: "/work/acme",
        writer: screen.writer,
        keys: screen.keys,
      });
      await settle();

      const picker = screen.drawn.join(" ").replace(/\s+/g, " ");
      expect(picker).toContain("Which Langy session should get this folder?");
      expect(picker).toContain("Instrument tracing");
      expect(picker).toContain("Add a retry to the agent");
      expect(picker).toContain("project ACME Shop");

      // The newest request is the first row, so the second row is the older
      // conversation.
      screen.press({ name: "2", sequence: "2" });
      await settle();
      expect(screen.drawn.join(" ")).toContain("Do you want to share this folder?");

      screen.press({ name: "return" });
      await expect(choice).resolves.toEqual({ action: "approve", request: first });
    });
  });
});
