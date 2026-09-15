/**
 * The pure half of the session context hook: the origin-remote grammar, the
 * fingerprint the dedup turns on, the OTLP header and traceparent readers,
 * and the shape of the record that goes on the wire.
 */

import { describe, expect, it } from "vitest";

import {
  buildSessionContextLogPayload,
  parseGitRemoteUrl,
  parseOtlpHeaders,
  parseTraceparent,
  SESSION_CONTEXT_EVENT_NAME,
  SESSION_CONTEXT_SCOPE_NAME,
  sessionContextFingerprint,
  sessionTitleFromPrompt,
} from "../session-context";

const repository = { host: "github.com", owner: "langwatch", name: "langwatch" };

describe("parseGitRemoteUrl", () => {
  describe("given the shapes an origin remote actually takes", () => {
    const parsed: Array<[string, ReturnType<typeof parseGitRemoteUrl>]> = [
      [
        "git@github.com:langwatch/langwatch.git",
        { host: "github.com", owner: "langwatch", name: "langwatch" },
      ],
      [
        "git@github.com:langwatch/langwatch",
        { host: "github.com", owner: "langwatch", name: "langwatch" },
      ],
      [
        "ssh://git@github.com:2222/langwatch/langwatch.git",
        { host: "github.com", owner: "langwatch", name: "langwatch" },
      ],
      [
        "https://github.com/langwatch/langwatch.git",
        { host: "github.com", owner: "langwatch", name: "langwatch" },
      ],
      [
        "https://github.com/langwatch/langwatch",
        { host: "github.com", owner: "langwatch", name: "langwatch" },
      ],
      [
        "https://token@github.com/langwatch/langwatch.git",
        { host: "github.com", owner: "langwatch", name: "langwatch" },
      ],
      [
        "http://git.acme.internal:8080/platform/tooling.git",
        { host: "git.acme.internal", owner: "platform", name: "tooling" },
      ],
      [
        "https://gitlab.com/group/subgroup/service.git",
        { host: "gitlab.com", owner: "group/subgroup", name: "service" },
      ],
      [
        "git@GitHub.com:LangWatch/LangWatch.git",
        { host: "github.com", owner: "LangWatch", name: "LangWatch" },
      ],
      ["  git@github.com:langwatch/langwatch.git\n", repository],
    ];

    it.each(parsed)("reads %s", (url, expected) => {
      expect(parseGitRemoteUrl(url)).toEqual(expected);
    });
  });

  describe("given a remote it cannot name a repository from", () => {
    const unparseable = [
      "",
      "   ",
      "not a url at all",
      "https://github.com/",
      "https://github.com/langwatch",
      "git@github.com:langwatch",
      "/srv/git/bare-repo.git",
    ];

    it.each(unparseable)("returns null for %s", (url) => {
      expect(parseGitRemoteUrl(url)).toBeNull();
    });
  });
});

describe("sessionContextFingerprint", () => {
  describe("given a branch and a worktree", () => {
    it("joins every field that can change mid-session", () => {
      expect(
        sessionContextFingerprint({
          repository,
          branch: "main",
          worktree: "review",
        }),
      ).toBe("github.com/langwatch/langwatch@main#review!~");
    });
  });

  describe("given a detached head in the main checkout", () => {
    it("leaves the missing fields empty rather than absent", () => {
      expect(sessionContextFingerprint({ repository })).toBe("github.com/langwatch/langwatch@#!~");
    });
  });

  describe("given the titles the record can carry", () => {
    it("changes when either title changes, so a rename re-posts", () => {
      const base = sessionContextFingerprint({ repository });
      const derived = sessionContextFingerprint({ repository }, { title: "Fix the build" });
      const declared = sessionContextFingerprint(
        { repository },
        { title: "Fix the build", name: "pr-reviewer" },
      );
      expect(new Set([base, derived, declared]).size).toBe(3);
    });
  });

  describe("given a session outside any repository", () => {
    it("still names the titles it carries", () => {
      expect(sessionContextFingerprint({}, { name: "pr-reviewer" })).toBe("@#!~pr-reviewer");
    });
  });

  describe("given two contexts differing only by branch", () => {
    it("produces different fingerprints", () => {
      expect(sessionContextFingerprint({ repository, branch: "main" })).not.toBe(
        sessionContextFingerprint({ repository, branch: "feat/hook" }),
      );
    });
  });
});

describe("parseOtlpHeaders", () => {
  describe("given a comma separated header variable", () => {
    it("splits each pair on its first equals sign", () => {
      expect(parseOtlpHeaders("Authorization=Bearer ik-lw-abc=def, x-scope=team a")).toEqual({
        Authorization: "Bearer ik-lw-abc=def",
        "x-scope": "team a",
      });
    });
  });

  describe("given nothing usable", () => {
    it("drops empty pairs, valueless keys and an unset variable", () => {
      expect(parseOtlpHeaders(undefined)).toEqual({});
      expect(parseOtlpHeaders(" , =orphan, novalue")).toEqual({});
    });
  });
});

describe("parseTraceparent", () => {
  describe("given a live version 00 traceparent", () => {
    it("reads the trace and span ids", () => {
      expect(parseTraceparent("00-16872e6253edb3e8748023ff172703c4-be7ce7c6bf1173f5-01")).toEqual({
        traceId: "16872e6253edb3e8748023ff172703c4",
        spanId: "be7ce7c6bf1173f5",
      });
    });
  });

  describe("given the all-zero ids that mean there is no context", () => {
    it("returns null rather than naming a trace that never existed", () => {
      // What an OTel SDK injects when the current context is invalid.
      expect(
        parseTraceparent("00-00000000000000000000000000000000-0000000000000000-00"),
      ).toBeNull();
      expect(
        parseTraceparent("00-00000000000000000000000000000000-be7ce7c6bf1173f5-01"),
      ).toBeNull();
      expect(
        parseTraceparent("00-16872e6253edb3e8748023ff172703c4-0000000000000000-01"),
      ).toBeNull();
    });
  });

  describe("given anything else", () => {
    it("returns null rather than guessing at the layout", () => {
      expect(parseTraceparent(undefined)).toBeNull();
      expect(parseTraceparent("")).toBeNull();
      expect(
        parseTraceparent("01-16872e6253edb3e8748023ff172703c4-be7ce7c6bf1173f5-01"),
      ).toBeNull();
      expect(parseTraceparent("00-tooshort-be7ce7c6bf1173f5-01")).toBeNull();
    });
  });
});

describe("buildSessionContextLogPayload", () => {
  const payload = buildSessionContextLogPayload({
    sessionId: "session-1",
    agent: "claude_code",
    context: { repository, branch: "main", worktree: "review" },
    timeUnixNano: "1700000000000000000",
    scopeVersion: "1.2.3",
    trace: {
      traceId: "16872e6253edb3e8748023ff172703c4",
      spanId: "be7ce7c6bf1173f5",
    },
  });
  const record = payload.resourceLogs[0]!.scopeLogs[0]!.logRecords[0]!;
  const attributes = Object.fromEntries(record.attributes.map((a) => [a.key, a.value.stringValue]));

  describe("given a full context and a live trace", () => {
    it("names the event on the record and in an attribute", () => {
      expect(record.eventName).toBe(SESSION_CONTEXT_EVENT_NAME);
      expect(attributes["event.name"]).toBe(SESSION_CONTEXT_EVENT_NAME);
    });

    it("carries the session, agent and repository identity", () => {
      expect(attributes).toMatchObject({
        "session.id": "session-1",
        "coding_agent.name": "claude_code",
        "vcs.repository.host": "github.com",
        "vcs.repository.owner": "langwatch",
        "vcs.repository.name": "langwatch",
        "vcs.ref.head.name": "main",
        "vcs.worktree.name": "review",
      });
    });

    it("emits under the langwatch hook scope from the langwatch cli service", () => {
      expect(payload.resourceLogs[0]!.scopeLogs[0]!.scope).toEqual({
        name: SESSION_CONTEXT_SCOPE_NAME,
        version: "1.2.3",
      });
      expect(payload.resourceLogs[0]!.resource.attributes).toEqual([
        { key: "service.name", value: { stringValue: "langwatch-cli" } },
      ]);
    });

    it("attaches the trace and span ids as lowercase hex", () => {
      expect(record.traceId).toBe("16872e6253edb3e8748023ff172703c4");
      expect(record.spanId).toBe("be7ce7c6bf1173f5");
    });

    it("carries no body, so the record is attributes only", () => {
      expect(record).not.toHaveProperty("body");
      expect(record.severityNumber).toBe(9);
      expect(record.severityText).toBe("INFO");
      expect(record.timeUnixNano).toBe("1700000000000000000");
    });
  });

  describe("given no branch, worktree or trace", () => {
    it("omits those attributes rather than sending empty ones", () => {
      const bare = buildSessionContextLogPayload({
        sessionId: "session-2",
        agent: "claude_code",
        context: { repository },
        timeUnixNano: "1700000000000000000",
        scopeVersion: "1.2.3",
      });
      const bareRecord = bare.resourceLogs[0]!.scopeLogs[0]!.logRecords[0]!;
      const keys = bareRecord.attributes.map((a) => a.key);

      expect(keys).not.toContain("vcs.ref.head.name");
      expect(keys).not.toContain("vcs.worktree.name");
      expect(bareRecord).not.toHaveProperty("traceId");
      expect(bareRecord).not.toHaveProperty("spanId");
    });
  });

  describe("given a session title", () => {
    const attrsOf = (title: string | null | undefined) => {
      const built = buildSessionContextLogPayload({
        sessionId: "session-3",
        agent: "codex",
        context: { repository },
        timeUnixNano: "1700000000000000000",
        scopeVersion: "1.2.3",
        title,
      });
      return built.resourceLogs[0]!.scopeLogs[0]!.logRecords[0]!.attributes;
    };

    /** @scenario "The harvest names the session by the first thing the user asked" */
    it("carries the title as an attribute", () => {
      expect(attrsOf("Fix the pricing rounding bug")).toContainEqual({
        key: "langwatch.session.title",
        value: { stringValue: "Fix the pricing rounding bug" },
      });
    });

    it("omits the attribute when there is no title", () => {
      for (const title of [null, undefined, ""]) {
        expect(attrsOf(title).map((a) => a.key)).not.toContain("langwatch.session.title");
      }
    });
  });
});

describe("sessionTitleFromPrompt", () => {
  describe("given a prompt someone typed", () => {
    it("keeps the first line, collapses whitespace, and caps the length", () => {
      expect(sessionTitleFromPrompt("  Fix   the pricing bug\nStart with tests.")).toBe(
        "Fix the pricing bug",
      );
      expect(sessionTitleFromPrompt(`${"x".repeat(200)} tail`)).toHaveLength(120);
    });
  });

  describe("given text no one typed", () => {
    it("names nothing from tags or blank text", () => {
      expect(sessionTitleFromPrompt("<environment_context>\n</environment_context>")).toBeNull();
      expect(sessionTitleFromPrompt("   \n  ")).toBeNull();
    });
  });
});
