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
import type {
  ApprovalCard,
  ApprovalPrompt,
  TerminalApproval,
} from "../approval";
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

/** A selector the test opens and answers by hand. */
function fakeApprovals() {
  const cards: ApprovalCard[] = [];
  const state = { closed: false, open: 0 };
  let deliver: ((value: TerminalApproval | null) => void) | null = null;
  const settle = (value: TerminalApproval | null): void => {
    const resolve = deliver;
    deliver = null;
    if (!resolve) return;
    state.open -= 1;
    resolve(value);
  };
  const prompt: ApprovalPrompt = (card) => {
    cards.push(card);
    state.open += 1;
    return {
      answer: new Promise<TerminalApproval | null>((resolve) => {
        deliver = resolve;
      }),
      close: () => {
        state.closed = true;
        settle(null);
      },
    };
  };
  return { prompt, cards, state, answer: settle };
}

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

  const start = (
    options: { withoutGit?: boolean; approvals?: ApprovalPrompt } = {},
  ) => {
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
      approvals: options.approvals ?? null,
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
      expect(lines.join("\n")).toContain(
        "Permission questions are answered on the card in LangWatch",
      );
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
      expect(printed).toContain("Read(app.py)");
      expect(printed).toContain("Read 2 lines");
      expect(printed).toContain("Bash(echo secret-output)");
      // The file the model read is not echoed here, only how much of it there was.
      expect(printed).not.toContain("print('hi')");

      const results = socket.sentOf("result");
      expect(results).toHaveLength(2);
      expect(results[0]!.ok).toBe(true);
      expect(String(results[0]!.text)).toContain("print('hi')");
      expect((results[1]!.output as { stdout: string }).stdout).toContain(
        "secret-output",
      );
    });
  });

  describe("when a call needs the developer's answer and this screen cannot ask", () => {
    /** @scenario "Without a terminal there is no selector" */
    it("asks the card, prints where to answer, and prints the outcome", async () => {
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
      expect(asked!.timeoutSeconds).toBe(300);
      expect(lines.join("\n")).toContain("Langy asked to run pnpm typecheck");
      expect(lines.join("\n")).toContain("Answer on the card in LangWatch");
      // The link belongs to the connect line, so an ask does not repeat it.
      expect(lines.join("\n")).not.toContain(CONVERSATION.url);
      expect(socket.sentOf("result")).toHaveLength(0);

      socket.deliver({
        type: "permission",
        callId: "call-1",
        decision: "deny",
      });
      await settle();
      expect(lines.join("\n")).toContain("Denied on the card in LangWatch");
      const [result] = socket.sentOf("result");
      expect(result!.ok).toBe(false);
      expect((result!.error as { code: string }).code).toBe("permission_denied");
    });

    it("carries the time limit of a command, and none for a file call", async () => {
      start();
      await settle();
      register();

      socket.deliver(
        callFrame({
          tool: "local_bash",
          params: { command: "pnpm typecheck", timeout: 3_600 },
        }),
      );
      await settle();
      const [command] = socket.sentOf("permission_required");
      expect(command!.timeoutSeconds).toBe(900);

      socket.deliver({
        ...callFrame({ tool: "local_read", params: { path: ".env" } }),
        call: {
          ...callFrame({ tool: "local_read", params: { path: ".env" } }).call,
          callId: "call-2",
        },
      });
      await settle();
      const asks = socket.sentOf("permission_required");
      expect(asks).toHaveLength(2);
      expect(asks[1]!.timeoutSeconds).toBeUndefined();
    });

    /** @scenario "A session grant silences the next matching command" */
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

    /** @scenario "A long command is printed once" */
    it("prints the command in full on the ask and the patterns on the answer", async () => {
      start();
      await settle();
      register();
      lines.length = 0;

      const chain =
        'git add app.py && git commit -m "feat: add tracing" && git push -u origin HEAD';
      socket.deliver(
        callFrame({ tool: "local_bash", params: { command: chain } }),
      );
      await settle();

      const [asked] = socket.sentOf("permission_required");
      expect(asked!.segments).toHaveLength(3);
      const askText = lines.join("\n");
      expect(askText.replace(/\n\s+/g, " ")).toContain(chain);

      lines.length = 0;
      socket.deliver({
        type: "permission",
        callId: "call-1",
        decision: "allow_pattern",
      });
      await waitUntil(() => socket.sentOf("result").length === 1, {
        what: "the allowed chain to answer",
      });
      const answer = lines.filter((line) => line.includes("Allowed"));
      expect(answer).toHaveLength(1);
      expect(answer[0]).toContain(
        '"git add", "git commit" and "git push" for this session',
      );
      expect(answer[0]).toContain("on the card in LangWatch");
      expect(answer[0]).not.toContain("feat: add tracing");

      // The grant covers every segment the card named, so the next chain of
      // the same shape runs with no card.
      socket.deliver({
        ...callFrame({ tool: "local_bash", params: { command: "x" } }),
        call: {
          ...callFrame({
            tool: "local_bash",
            params: { command: 'git add README.md && git commit -m "docs"' },
          }).call,
          callId: "call-2",
        },
      });
      await waitUntil(() => socket.sentOf("result").length === 2, {
        what: "the covered chain to answer with no second card",
      });
      expect(socket.sentOf("permission_required")).toHaveLength(1);
    });

    /** @scenario "A grant lives with the session, not with the conversation" */
    it("forgets the grant when the command line is started again", async () => {
      start();
      await settle();
      register();
      socket.deliver(
        callFrame({ tool: "local_bash", params: { command: "true" } }),
      );
      await settle();
      socket.deliver({
        type: "permission",
        callId: "call-1",
        decision: "allow_pattern",
      });
      await waitUntil(() => socket.sentOf("result").length === 1, {
        what: "the allowed command to answer",
      });
      await session.client.stop();

      // The same conversation, the same command, a new run of the command
      // line: the grant belonged to the session, so it is gone with it.
      start();
      await settle();
      register();
      socket.deliver(
        callFrame({ tool: "local_bash", params: { command: "true" } }),
      );
      await waitUntil(() => socket.sentOf("permission_required").length === 1, {
        what: "the second session to ask again",
      });
    });
  });

  describe("when the developer answers in the terminal", () => {
    const ask = async (command = "pnpm typecheck") => {
      const approvals = fakeApprovals();
      start({ approvals: approvals.prompt });
      await settle();
      register();
      lines.length = 0;
      socket.deliver(
        callFrame({ tool: "local_bash", params: { command } }),
      );
      await settle();
      return approvals;
    };

    /** @scenario "The selector offers the session grant first" */
    it("opens the selector with the folder, the command and the time limit", async () => {
      const approvals = await ask();

      expect(approvals.cards).toHaveLength(1);
      const [card] = approvals.cards;
      expect(card!.title).toContain("Langy wants to run in");
      expect(card!.subject).toBe("pnpm typecheck");
      expect(card!.description).toContain(
        "Stops after 5 minutes if it has not finished.",
      );
      expect(card!.options.map((option) => option.value)).toEqual([
        "allow_pattern",
        "allow_once",
        "deny",
      ]);
      expect(card!.options[0]!.label).toBe(
        'Yes, allow "pnpm typecheck" for this session',
      );
      // The card in the panel is asked at the same time.
      expect(socket.sentOf("permission_required")).toHaveLength(1);
    });

    /** @scenario "Allowing the pattern runs the call and settles the line" */
    it("runs the call, tells the platform and grants the pattern", async () => {
      const approvals = await ask("true");

      approvals.answer({ decision: "allow_pattern" });
      await waitUntil(() => socket.sentOf("result").length === 1, {
        what: "the allowed command to answer",
      });

      const [answered] = socket.sentOf("permission_answered");
      expect(answered).toBeDefined();
      expect(answered!.callId).toBe("call-1");
      expect(answered!.decision).toBe("allow_pattern");
      expect(answered!.patterns).toEqual(["true *"]);
      expect(lines.join("\n")).toContain('Allowed "true *" for this session');
      expect(lines.join("\n")).not.toContain("on the card in LangWatch");

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

    /** @scenario "Allowing once runs the call and grants nothing" */
    it("runs the call once and carries no patterns", async () => {
      const approvals = await ask("true");

      approvals.answer({ decision: "allow_once" });
      await waitUntil(() => socket.sentOf("result").length === 1, {
        what: "the allowed command to answer",
      });

      const [answered] = socket.sentOf("permission_answered");
      expect(answered!.decision).toBe("allow_once");
      expect(answered!.patterns).toBeUndefined();
      expect(lines.join("\n")).toContain("Allowed once");
    });

    /** @scenario "Denying reads one line of text and sends it back to Langy" */
    it("refuses the call with the reason the developer typed", async () => {
      const approvals = await ask();

      approvals.answer({ decision: "deny", reason: "use the staging database" });
      await waitUntil(() => socket.sentOf("result").length === 1, {
        what: "the denied command to answer",
      });

      const [answered] = socket.sentOf("permission_answered");
      expect(answered!.decision).toBe("deny");
      const [result] = socket.sentOf("result");
      expect(result!.ok).toBe(false);
      const error = result!.error as { code: string; message: string };
      expect(error.code).toBe("permission_denied");
      expect(error.message).toContain("use the staging database");
      expect(lines.join("\n")).toContain("Denied: use the staging database");
    });

    /** @scenario "Escape denies with no reason" */
    it("refuses the call and still says who refused when nothing was typed", async () => {
      const approvals = await ask();

      approvals.answer({ decision: "deny" });
      await waitUntil(() => socket.sentOf("result").length === 1, {
        what: "the denied command to answer",
      });

      const error = socket.sentOf("result")[0]!.error as { message: string };
      expect(error.message).toContain("The developer denied pnpm typecheck");
      expect(lines.join("\n")).toContain("Denied");
    });

    /** @scenario "Two questions at once are asked one at a time" */
    it("asks the second question only after the first one is answered", async () => {
      const approvals = await ask("true");

      socket.deliver({
        ...callFrame({ tool: "local_bash", params: { command: "false" } }),
        call: {
          ...callFrame({ tool: "local_bash", params: { command: "false" } })
            .call,
          callId: "call-2",
        },
      });
      await settle();
      expect(approvals.cards).toHaveLength(1);
      expect(approvals.state.open).toBe(1);

      approvals.answer({ decision: "allow_once" });
      await waitUntil(() => approvals.cards.length === 2, {
        what: "the second question to open",
      });
      expect(approvals.cards[1]!.subject).toBe("false");
      expect(approvals.state.open).toBe(1);
    });

    /** @scenario "The card can answer first and the settled line names it" */
    it("closes the selector when the card answers first and names the card", async () => {
      const approvals = await ask("true");

      socket.deliver({
        type: "permission",
        callId: "call-1",
        decision: "allow_once",
      });
      await waitUntil(() => socket.sentOf("result").length === 1, {
        what: "the command the card allowed to answer",
      });

      expect(socket.sentOf("permission_answered")).toHaveLength(0);
      expect(lines.join("\n")).toContain("Allowed once on the card in LangWatch");
      // The selector is closed rather than left waiting for a key.
      expect(approvals.state.closed).toBe(true);
    });

    /** @scenario "A card answer after the terminal answered is ignored" */
    it("ignores the card's answer once the terminal answered", async () => {
      const approvals = await ask("true");

      approvals.answer({ decision: "allow_once" });
      await waitUntil(() => socket.sentOf("result").length === 1, {
        what: "the allowed command to answer",
      });
      lines.length = 0;

      socket.deliver({
        type: "permission",
        callId: "call-1",
        decision: "deny",
      });
      await settle();

      expect(socket.sentOf("result")).toHaveLength(1);
      expect(lines.join("\n")).not.toContain("on the card in LangWatch");
    });

    /** @scenario "Transcript lines are held while the selector is open" */
    it("holds the transcript until the question is answered", async () => {
      const approvals = await ask();
      lines.length = 0;

      socket.deliver({
        ...callFrame({ tool: "local_read", params: { path: "app.py" } }),
        call: {
          ...callFrame({ tool: "local_read", params: { path: "app.py" } }).call,
          callId: "call-2",
        },
      });
      await waitUntil(() => socket.sentOf("result").length === 1, {
        what: "the read to answer while the question is open",
      });
      expect(lines).toEqual([]);

      approvals.answer({ decision: "deny" });
      await waitUntil(() => lines.join("\n").includes("Read(app.py)"), {
        what: "the held lines to be printed",
      });
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
      await waitUntil(() => lines.join("\n").includes("Allowed once"), {
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
      await waitUntil(() => lines.join("\n").includes("Allowed once"), {
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
