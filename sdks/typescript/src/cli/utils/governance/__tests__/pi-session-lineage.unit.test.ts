import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
  appendFile,
  symlink,
  chmod,
} from "node:fs/promises";
import type * as FsPromises from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parsePiSessionFile } from "../pi-session-file";
import { NO_LINEAGE, resolvePiLineage } from "../pi-session-lineage";
import { createPiSessionStream } from "../pi-session-stream";
import { buildPiEventsPayload, buildPiTurnEvents } from "../pi-turn-events";

/**
 * The same real, sanitised 132-row session the turn-events tests use: a session
 * a user actually ran, whose header carries no `parentSession`. Ground truth
 * for the unsplit case — none of the five pi sessions on this machine was a
 * fork, so every SPLIT session below is written by hand, to the shape pi
 * documents.
 */
const REAL_SESSION = parsePiSessionFile(
  readFileSync(
    join(__dirname, "fixtures", "pi-session-real-shape.jsonl"),
    "utf8",
  ),
);

const PARENT_ID = "01a09b6b-41ae-747a-9edf-b238fff5fdae";
const CHILD_ID = "01a09b9d-2b21-74c8-a776-f5eb25fccdba";

let dir: string;

/**
 * A home-directory-shaped place to keep session files. The point of the shape
 * is the leak test: a bare `/tmp/x` would pass an assertion that a real
 * `/Users/someone/.pi/...` path would fail.
 */
async function sessionsDir(): Promise<string> {
  const path = join(dir, "home", "someone", ".pi", "agent", "sessions");
  await mkdir(path, { recursive: true });
  return path;
}

function headerLine(fields: Record<string, unknown>): string {
  return JSON.stringify({
    type: "session",
    version: 3,
    timestamp: "2026-09-13T16:32:43.810Z",
    cwd: "/tmp/project",
    ...fields,
  });
}

function userRow(id: string, at: string): string {
  return JSON.stringify({
    type: "message",
    id,
    parentId: null,
    timestamp: at,
    message: {
      role: "user",
      content: [{ type: "text", text: "x" }],
      timestamp: Date.parse(at),
    },
  });
}

/** Write a session file and return its path. */
async function writeSession(
  name: string,
  lines: readonly string[],
): Promise<string> {
  const path = join(await sessionsDir(), name);
  await writeFile(path, `${lines.join("\n")}\n`, "utf8");
  return path;
}

/** The child of `parentPath`, as pi writes one: the parent's PATH in the header. */
async function writeChildSplitOff(parentPath: string): Promise<string> {
  return writeSession("child.jsonl", [
    headerLine({ id: CHILD_ID, parentSession: parentPath }),
    userRow("aaaaaaaa", "2026-09-13T16:32:50.000Z"),
  ]);
}

const execFileAsync = promisify(execFile);

/**
 * A parsed child header whose recorded parent path is exactly `parentPath` —
 * built through the real parser, so the value under test travels the route a
 * real header does rather than being handed straight to the resolver.
 */
function headerWithParent(parentPath: string) {
  return parsePiSessionFile(
    `${headerLine({ id: CHILD_ID, parentSession: parentPath })}\n`,
  ).header;
}

/**
 * A child split off a parent, carried all the way to the serialised wire body.
 * Returns the parent's path so the caller can assert against the real string
 * rather than a remembered fragment of it.
 */
async function wireForChild(options: {
  deleteParent: boolean;
}): Promise<{ wire: string; parentPath: string }> {
  const parentPath = await writeSession("parent.jsonl", [
    headerLine({ id: PARENT_ID }),
  ]);
  const childPath = await writeChildSplitOff(parentPath);
  if (options.deleteParent) await rm(parentPath);
  const child = parsePiSessionFile(readFileSync(childPath, "utf8"));

  const wire = JSON.stringify(
    buildPiEventsPayload({
      events: buildPiTurnEvents({ session: child, lineage: await resolvePiLineage(child.header) }),
      scopeVersion: "0.0.0-test",
    }),
  );
  return { wire, parentPath };
}

/**
 * The path must be absent whole and in every fragment that would identify the
 * machine's owner: the account name is the part that matters, and a value
 * truncated anywhere still carries it.
 */
function expectNoParentPath(wire: string, parentPath: string): void {
  expect(wire).not.toContain(parentPath);
  expect(wire).not.toContain(".pi/agent/sessions");
  expect(wire).not.toContain("/home/someone");
  expect(wire).not.toContain("parent.jsonl");
  expect(wire).not.toContain(dir);
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pi-lineage-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("pi session lineage", () => {
  /** @scenario "A session started fresh has no parent" */
  it("records no parent and no branch for a session that was not split off another", async () => {
    expect(REAL_SESSION.header?.parentSessionFile).toBeNull();

    const lineage = await resolvePiLineage(REAL_SESSION.header);
    expect(lineage).toEqual(NO_LINEAGE);

    // Absent, not false: the fold's blank means "never reported", and stamping
    // `is_fork: false` on every unsplit session would claim we had checked.
    const events = buildPiTurnEvents({ session: REAL_SESSION, lineage });
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.attributes).not.toHaveProperty("parent_session_id");
      expect(event.attributes).not.toHaveProperty("is_fork");
    }
  });

  /** @scenario "A session split off another records where it came from" */
  it("records the earlier session as the parent and marks the split a branch", async () => {
    const parentPath = await writeSession("parent.jsonl", [
      headerLine({ id: PARENT_ID }),
      userRow("bbbbbbbb", "2026-09-13T15:38:20.000Z"),
    ]);
    const childPath = await writeChildSplitOff(parentPath);
    const child = parsePiSessionFile(readFileSync(childPath, "utf8"));

    const lineage = await resolvePiLineage(child.header);
    expect(lineage).toEqual({ parentSessionId: PARENT_ID, isFork: true });

    const events = buildPiTurnEvents({ session: child, lineage });
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.attributes.parent_session_id).toBe(PARENT_ID);
      expect(event.attributes.is_fork).toBe(true);
    }
  });

  /** @scenario "The parent is recorded as an identifier, and the parent's file location is not stored" */
  it("resolves the parent's path to the parent's own id and emits the path nowhere", async () => {
    const parentPath = await writeSession("parent.jsonl", [
      headerLine({ id: PARENT_ID }),
    ]);
    const childPath = await writeChildSplitOff(parentPath);
    const child = parsePiSessionFile(readFileSync(childPath, "utf8"));

    // What pi gave us is a path, and it is somebody's home directory.
    expect(child.header?.parentSessionFile).toBe(parentPath);
    expect(parentPath).toContain("/.pi/agent/sessions/");

    const lineage = await resolvePiLineage(child.header);
    expect(lineage.parentSessionId).toBe(PARENT_ID);

    // The whole wire body, not the one attribute we remembered to check: a leak
    // is a leak wherever it lands, and `parentSessionId` is once-set on the
    // server, so a path that reaches it can never be taken back.
    const wire = JSON.stringify(
      buildPiEventsPayload({
        events: buildPiTurnEvents({ session: child, lineage }),
        scopeVersion: "0.0.0-test",
      }),
    );
    expect(wire).toContain(PARENT_ID);
    expect(wire).not.toContain(parentPath);
    expect(wire).not.toContain(".pi/agent/sessions");
    expect(wire).not.toContain("/home/someone");
    expect(wire).not.toContain(dir);
    // The resolved value itself is an id, not a path in disguise.
    expect(lineage.parentSessionId).not.toContain("/");
  });

  /**
   * The leak guarantee on its own, with nothing in front of it that can throw.
   *
   * Deliberately unbound: the scenario above already binds, and this asserts
   * nothing about which identifier is correct — that is the whole point. Every
   * other test here checks the resolved id before it checks the payload, so a
   * break that moves a path INTO the id stops them on the identity assertion
   * and never reaches the leak check. Measured, not supposed: M1 (fall back to
   * the raw path when the parent header cannot be read) left the bound leak
   * test GREEN, and M2 (use the path as the id outright) failed it on
   * `expected '/var/folders/…' to be '01a09b6b-…'` — an identity message, from
   * a line above the payload assertions.
   *
   * Both ways `resolvePiLineage` can produce a path are covered, because the
   * two breaks enter through different ones: M2 through a parent that reads,
   * M1 through a parent that does not.
   */
  it("never puts the parent's file location on the wire, whether or not the parent reads", async () => {
    const readable = await wireForChild({ deleteParent: false });
    expectNoParentPath(readable.wire, readable.parentPath);

    const unreadable = await wireForChild({ deleteParent: true });
    expectNoParentPath(unreadable.wire, unreadable.parentPath);
  });

  /** @scenario "A parent whose file has been deleted leaves the parent blank" */
  it("leaves the parent blank but still marks a branch when the parent file is gone", async () => {
    const parentPath = await writeSession("parent.jsonl", [
      headerLine({ id: PARENT_ID }),
    ]);
    const childPath = await writeChildSplitOff(parentPath);
    await rm(parentPath);
    const child = parsePiSessionFile(readFileSync(childPath, "utf8"));

    const lineage = await resolvePiLineage(child.header);
    expect(lineage).toEqual({ parentSessionId: null, isFork: true });

    const events = buildPiTurnEvents({ session: child, lineage });
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.attributes).not.toHaveProperty("parent_session_id");
      expect(event.attributes.is_fork).toBe(true);
    }
    // A deleted parent must not fall back to naming the file we could not read.
    expect(JSON.stringify(events)).not.toContain(parentPath);
  });

  /**
   * `resolvePiLineage` never rejecting is load-bearing outside this module: the
   * session reader awaits it inside a poll pass whose own contract is "never an
   * error", with no try/catch of its own, so a rejection here takes down a whole
   * tick of capture. That contract was verified by reading the code, which is
   * how the leak assertion above came to be unreachable. This verifies it by
   * execution instead, against the failures a real filesystem produces rather
   * than the one — a deleted file — the happy path already covers.
   *
   * Unbound on purpose: no scenario claims this, it pins a contract.
   */
  it("resolves rather than rejects for every unreadable kind of parent path", async () => {
    const base = await sessionsDir();

    const aDirectory = join(base, "a-directory");
    await mkdir(aDirectory, { recursive: true });

    const empty = join(base, "empty.jsonl");
    await writeFile(empty, "", "utf8");

    const binary = join(base, "binary.jsonl");
    await writeFile(binary, Buffer.from([0x00, 0xff, 0xfe, 0x01, 0x0a]));

    // One line, no newline, larger than the 64 KiB read window: not a pi file,
    // and the window must not be mistaken for a complete header.
    const oversized = join(base, "oversized.jsonl");
    await writeFile(oversized, "x".repeat(70 * 1024), "utf8");

    const brokenLink = join(base, "broken-link.jsonl");
    await symlink(join(base, "does-not-exist.jsonl"), brokenLink);

    const loopA = join(base, "loop-a.jsonl");
    const loopB = join(base, "loop-b.jsonl");
    await symlink(loopB, loopA);
    await symlink(loopA, loopB);

    const unreadable = join(base, "unreadable.jsonl");
    await writeFile(unreadable, headerLine({ id: PARENT_ID }), "utf8");
    await chmod(unreadable, 0o000);

    // Valid JSON, wrong shape: an array has no `type`, and reading `entry.type`
    // off one must not be mistaken for a header.
    const notAnObject = join(base, "not-an-object.jsonl");
    await writeFile(notAnObject, '[{"type":"session","id":"x"}]\n', "utf8");

    const cases: ReadonlyArray<[string, string]> = [
      ["a directory", aDirectory],
      ["an empty file", empty],
      ["a binary file", binary],
      ["a first line past the read window", oversized],
      ["a broken symlink", brokenLink],
      ["a symlink loop", loopA],
      // Mode bits do not apply to UID 0, which reads the file happily and gets
      // a real parent id back. The case discriminates for an unprivileged user
      // only, so under root it is dropped rather than asserted and failed.
      ...(process.getuid?.() === 0
        ? []
        : [["a file with no read permission", unreadable] as [string, string]]),
      ["a path containing a NUL byte", `${join(base, "nul")} .jsonl`],
      ["a path far past the length limit", join(base, "z".repeat(5000))],
      ["a header that is valid JSON but not an object", notAnObject],
    ];

    for (const [what, parentPath] of cases) {
      const lineage = await resolvePiLineage(headerWithParent(parentPath));
      // Blank parent, still a branch: the path was there, we just could not
      // follow it, and that is the deleted-parent rule for every failure kind.
      expect(lineage, what).toEqual({ parentSessionId: null, isFork: true });
    }
  });

  /**
   * The failure mode one step worse than a rejection: a parent path that is a
   * FIFO, or a stalled network mount, makes a plain `open(2)` block forever —
   * it does not return and does not throw, so a never-throws contract does not
   * cover it. Measured before the fix: no result after three seconds, and the
   * probe process then would not exit at all, because the blocked open holds a
   * libuv threadpool thread.
   *
   * The race is deliberate. Without it a regression hangs the run instead of
   * reddening it, and a hang in CI reads as an infrastructure problem rather
   * than as this line being wrong.
   *
   * Unbound on purpose: no scenario claims this, it pins a contract.
   */
  it("settles instead of blocking when the parent path never opens", async () => {
    const base = await sessionsDir();
    const fifo = join(base, "parent-fifo.jsonl");
    await execFileAsync("mkfifo", [fifo]);

    const settled = await Promise.race([
      resolvePiLineage(headerWithParent(fifo)),
      new Promise<"blocked">((resolve) =>
        setTimeout(() => resolve("blocked"), 3000),
      ),
    ]);

    expect(settled).toEqual({ parentSessionId: null, isFork: true });
  });

  /**
   * The one guard no filesystem input can reach. Removing the `.catch` on
   * `handle.close()` reddens nothing, because a close following a successful
   * open does not fail on a local disk — but if it ever did, on a network mount
   * that defers errors to close, it would throw out of a `finally` and discard
   * an answer we had already read. That is precisely the rejection the session
   * reader has no try/catch for.
   *
   * So this injects the fault instead of finding it: a handle that reads fine
   * and refuses to close. It is fault injection, not evidence about any real
   * filesystem, and it asserts the read result survives rather than merely that
   * nothing throws.
   *
   * Unbound on purpose: no scenario claims this, it pins a contract.
   */
  it("keeps the parent it already read when the file refuses to close", async () => {
    const header = `${headerLine({ id: PARENT_ID })}\n`;

    vi.resetModules();
    vi.doMock("node:fs/promises", async () => {
      const actual =
        await vi.importActual<typeof FsPromises>("node:fs/promises");
      return {
        ...actual,
        open: async () => ({
          read: async (buffer: Buffer) => ({
            bytesRead: Buffer.from(header, "utf8").copy(buffer),
          }),
          close: async () => {
            throw new Error("close failed");
          },
        }),
      };
    });

    const { resolvePiLineage: resolveWithFailingClose } = await import(
      "../pi-session-lineage.js"
    );
    const lineage = await resolveWithFailingClose(
      headerWithParent("/any/path/parent.jsonl"),
    );

    vi.doUnmock("node:fs/promises");
    vi.resetModules();

    expect(lineage).toEqual({ parentSessionId: PARENT_ID, isFork: true });
  });

  /** @scenario "Resuming a session does not create a second one" */
  it("records one session across three runs that appended to the same file", async () => {
    const path = await writeSession("resumed.jsonl", [
      headerLine({ id: CHILD_ID }),
      userRow("11111111", "2026-09-13T16:32:50.000Z"),
    ]);
    const stream = createPiSessionStream();

    const first = await stream.read(path);
    await appendFile(path, `${userRow("22222222", "2026-09-13T17:00:00.000Z")}\n`);
    const second = await stream.read(path);
    await appendFile(path, `${userRow("33333333", "2026-09-13T18:00:00.000Z")}\n`);
    const third = await stream.read(path);

    const all = [...first, ...second, ...third];
    expect(all.length).toBe(3);

    // One session, not three: a resume appends to the file pi already had, so
    // every run's events carry the id the first run established.
    const sessionIds = new Set(all.map((e) => e.attributes["session.id"]));
    expect([...sessionIds]).toEqual([CHILD_ID]);

    // And a resume is not a split: nothing here is a branch of anything.
    const resumed = parsePiSessionFile(readFileSync(path, "utf8"));
    expect(await resolvePiLineage(resumed.header)).toEqual(NO_LINEAGE);
    for (const event of all) {
      expect(event.attributes).not.toHaveProperty("parent_session_id");
      expect(event.attributes).not.toHaveProperty("is_fork");
    }
  });
});
