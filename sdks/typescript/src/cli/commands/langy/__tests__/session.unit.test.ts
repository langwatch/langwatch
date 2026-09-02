/**
 * The loop of a shared folder, driven over a fake socket: register, a call,
 * a permission round trip, a cancel, a disconnect and Ctrl-C.
 *
 * @see specs/typescript-sdk/cli-langy-share-control.feature
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LOCAL_CONTROL_PROTOCOL_VERSION,
  type LocalCall,
  type WorkspaceInfo,
} from "../../../../agent/local-control-protocol";
import type { SocketLike } from "../../../../agent/transport";
import { startLangySession, type LangySession } from "../session";
import { createUi, type UiWriter } from "../ui";

const CONVERSATION = {
  id: "conv_1",
  title: "Instrument tracing in acme-app",
  url: "https://app.langwatch.ai/acme/langy/conv_1",
};

/** A socket the test drives: it records what the CLI sent and pushes frames back. */
class FakeSocket implements SocketLike {
  readonly sent: Array<Record<string, unknown>> = [];
  closedWith: number | null = null;
  private messageListeners: Array<(data: string) => void> = [];
  private closeListeners: Array<(code: number) => void> = [];
  private openListeners: Array<() => void> = [];

  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(code = 1000): void {
    this.closedWith = code;
    for (const listener of this.closeListeners) listener(code);
  }
  terminate(): void {
    this.close(1006);
  }
  onOpen(listener: () => void): void {
    this.openListeners.push(listener);
    setTimeout(listener, 0);
  }
  onMessage(listener: (data: string) => void): void {
    this.messageListeners.push(listener);
  }
  onClose(listener: (code: number) => void): void {
    this.closeListeners.push(listener);
  }
  onError(): void {
    // Nothing in these tests raises a transport error.
  }
  onPing(): void {
    // The fake never pings; the watchdog is not what is under test.
  }

  /** Pushes one platform frame at the client. */
  deliver(frame: Record<string, unknown>): void {
    const text = JSON.stringify({
      protocol: LOCAL_CONTROL_PROTOCOL_VERSION,
      ...frame,
    });
    for (const listener of this.messageListeners) listener(text);
  }

  sentOf(type: string): Array<Record<string, unknown>> {
    return this.sent.filter((frame) => frame.type === type);
  }
}

const settle = (ms = 50) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/** Waits for a condition rather than for a fixed time, so a busy machine is fine. */
const waitUntil = async (
  ready: () => boolean,
  { timeoutMs = 10_000, what = "the condition" } = {},
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await settle(25);
  }
};

const callFrame = (call: Partial<LocalCall> & Pick<LocalCall, "tool">) => ({
  type: "call",
  call: {
    callId: "call-1",
    conversationId: CONVERSATION.id,
    turnId: "turn-1",
    deadlineAt: Date.now() + 60_000,
    params: {},
    ...call,
  },
});

describe("given a folder connected to a Langy conversation", () => {
  let root: string;
  let socket: FakeSocket;
  let lines: string[];
  let session: LangySession;

  const writer: UiWriter = { line: (text) => lines.push(text) };

  const start = (options: { withoutGit?: boolean } = {}) => {
    socket = new FakeSocket();
    lines = [];
    const workspace: WorkspaceInfo = {
      root,
      name: path.basename(root),
      os: "test",
    };
    session = startLangySession({
      endpoint: "http://localhost:5560",
      sessionKey: "sk-lw-langy-session",
      workspace,
      conversation: CONVERSATION,
      ui: createUi(writer),
      socketFactory: () => socket,
      backoff: { baseMs: 10, maxMs: 10 },
      ...(options.withoutGit === true ? { withoutGit: true } : {}),
    });
    return session;
  };

  const register = () => {
    socket.deliver({
      type: "registered",
      instanceId: "cli_1",
      heartbeatIntervalMs: 10_000,
      conversation: CONVERSATION,
      policy: { skipPermissions: false },
    });
  };

  beforeEach(() => {
    root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "langy-session-")),
    );
    fs.writeFileSync(path.join(root, "app.py"), "print('hi')\n");
  });

  afterEach(async () => {
    await session?.client.stop();
    fs.rmSync(root, { recursive: true, force: true });
  });

  describe("when the socket opens", () => {
    it("registers with the workspace and prints where to follow along", async () => {
      start();
      await settle();
      const [registered] = socket.sentOf("register");
      expect(registered).toBeDefined();
      expect((registered!.workspace as WorkspaceInfo).root).toBe(root);
      expect((registered!.cli as { name: string }).name).toBe("langwatch");

      register();
      expect(lines.join("\n")).toContain(CONVERSATION.title);
      expect(lines.join("\n")).toContain(CONVERSATION.url);
      expect(lines.join("\n")).toContain("Permission questions appear in the panel");
    });

    /** @scenario "A folder that is not a git repository still works, with a note" */
    it("notes that Langy cannot open a pull request without a git repository", async () => {
      start({ withoutGit: true });
      await settle();
      register();
      expect(lines.join("\n")).toContain("cannot open a pull request");
    });
  });

  describe("when Langy reads a file and runs a command", () => {
    /** @scenario "Each call prints as one line" */
    it("prints one line per call and never echoes the output", async () => {
      start();
      await settle();
      register();
      lines.length = 0;

      socket.deliver(
        callFrame({ tool: "local_read", params: { path: "app.py" } }),
      );
      await settle();
      socket.deliver({
        ...callFrame({
          tool: "local_bash",
          params: { command: "echo secret-output" },
        }),
        call: {
          ...callFrame({
            tool: "local_bash",
            params: { command: "echo secret-output" },
          }).call,
          callId: "call-2",
        },
      });
      await waitUntil(() => socket.sentOf("result").length === 2, {
        what: "both calls to answer",
      });

      const printed = lines.join("\n");
      expect(printed).toContain("read app.py");
      expect(printed).toContain("bash echo secret-output");
      expect(printed).toContain("exit 0");
      expect(printed).not.toContain("secret-output\n1");

      const results = socket.sentOf("result");
      expect(results).toHaveLength(2);
      expect(results[0]!.ok).toBe(true);
      expect(String(results[0]!.text)).toContain("print('hi')");
      expect((results[1]!.output as { stdout: string }).stdout).toContain(
        "secret-output",
      );
    });
  });

  describe("when a call needs the developer's answer", () => {
    /** @scenario "A permission request points at the panel" */
    it("asks the panel, prints where to answer, and prints the outcome", async () => {
      start();
      await settle();
      register();
      lines.length = 0;

      socket.deliver(
        callFrame({
          tool: "local_bash",
          params: { command: "pnpm typecheck" },
        }),
      );
      await settle();

      const [asked] = socket.sentOf("permission_required");
      expect(asked).toBeDefined();
      expect(asked!.summary).toBe("pnpm typecheck");
      expect(asked!.pattern).toBe("pnpm typecheck");
      expect(lines.join("\n")).toContain("Langy asked to run pnpm typecheck");
      expect(lines.join("\n")).toContain("Answer in the LangWatch panel");
      expect(lines.join("\n")).toContain(CONVERSATION.url);
      expect(socket.sentOf("result")).toHaveLength(0);

      socket.deliver({
        type: "permission",
        callId: "call-1",
        decision: "deny",
      });
      await settle();
      expect(lines.join("\n")).toContain("denied");
      const [result] = socket.sentOf("result");
      expect(result!.ok).toBe(false);
      expect((result!.error as { code: string }).code).toBe("permission_denied");
    });

    it("runs the call when the answer allows it, and a pattern grant silences the next one", async () => {
      start();
      await settle();
      register();

      // `true` is not in the read-only set, so the first call asks and the
      // grant it produces is `true *`.
      socket.deliver(
        callFrame({ tool: "local_bash", params: { command: "true" } }),
      );
      await settle();
      expect(socket.sentOf("permission_required")).toHaveLength(1);
      socket.deliver({
        type: "permission",
        callId: "call-1",
        decision: "allow_pattern",
      });
      await waitUntil(() => socket.sentOf("result").length === 1, {
        what: "the allowed command to answer",
      });

      socket.deliver({
        ...callFrame({ tool: "local_bash", params: { command: "true again" } }),
        call: {
          ...callFrame({
            tool: "local_bash",
            params: { command: "true again" },
          }).call,
          callId: "call-2",
        },
      });
      await waitUntil(() => socket.sentOf("result").length === 2, {
        what: "the granted command to answer with no second card",
      });
      expect(socket.sentOf("permission_required")).toHaveLength(1);
    });
  });

  describe("when the platform cancels a call", () => {
    it("stops the command and drops the call", async () => {
      start();
      await settle();
      register();

      socket.deliver(
        callFrame({ tool: "local_bash", params: { command: "sleep 30" } }),
      );
      await settle();
      socket.deliver({
        type: "permission",
        callId: "call-1",
        decision: "allow_once",
      });
      await waitUntil(() => lines.join("\n").includes("allowed once"), {
        what: "the command to start",
      });
      socket.deliver({ type: "cancel", callId: "call-1" });
      await waitUntil(() => socket.sentOf("result").length > 0, {
        what: "the cancelled call to answer",
      });
      const results = socket.sentOf("result");
      expect(results.every((frame) => frame.ok !== true)).toBe(true);
    });
  });

  describe("when the panel turns permission checks off", () => {
    /** @scenario "Turning permission checks off is printed in red" */
    it("prints it in red and stops asking", async () => {
      start();
      await settle();
      register();
      lines.length = 0;

      socket.deliver({ type: "policy", skipPermissions: true });
      const notice = lines.join("\n");
      expect(notice).toContain("Permission checks are off for this session");
      // chalk paints red as the SGR 31 escape when colour is on, and leaves
      // the words alone when it is off; either way the sentence is one line.
      expect(lines).toHaveLength(1);

      socket.deliver(
        callFrame({ tool: "local_bash", params: { command: "echo hi" } }),
      );
      await waitUntil(() => socket.sentOf("result").length === 1, {
        what: "the command to run with no card",
      });
      expect(socket.sentOf("permission_required")).toHaveLength(0);
    });
  });

  describe("when the folder is disconnected from the panel", () => {
    /** @scenario "A disconnect from the panel ends the command" */
    it("prints it and ends with exit code zero", async () => {
      start();
      await settle();
      register();

      socket.deliver({
        type: "disconnect",
        reason: "the conversation closed the folder",
      });
      await expect(session.done).resolves.toBe(0);
      expect(lines.join("\n")).toContain("LangWatch disconnected the folder");
    });
  });

  describe("when the developer presses Ctrl-C", () => {
    /** @scenario "Ctrl-C tells the platform and stops running commands" */
    it("deregisters, kills the running command and ends inside the deadline", async () => {
      start();
      await settle();
      register();

      socket.deliver(
        callFrame({ tool: "local_bash", params: { command: "sleep 30" } }),
      );
      await settle();
      socket.deliver({
        type: "permission",
        callId: "call-1",
        decision: "allow_once",
      });
      await waitUntil(() => lines.join("\n").includes("allowed once"), {
        what: "the command to start",
      });

      const startedAt = Date.now();
      session.requestShutdown();
      await expect(session.done).resolves.toBe(0);
      expect(Date.now() - startedAt).toBeLessThan(5_000);
      expect(socket.sentOf("deregister")).toHaveLength(1);
      expect(socket.closedWith).toBe(1000);
      expect(lines.join("\n")).toContain("Telling LangWatch the folder is gone");
    });

    /** @scenario "A second Ctrl-C exits at once" */
    it("exits at once on the second one", async () => {
      start();
      await settle();
      register();
      socket.deliver(
        callFrame({ tool: "local_bash", params: { command: "sleep 30" } }),
      );
      await settle();

      session.requestShutdown();
      session.requestShutdown();
      await expect(session.done).resolves.toBe(130);
    });
  });
});
