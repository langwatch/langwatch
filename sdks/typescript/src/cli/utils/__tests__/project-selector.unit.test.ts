/**
 * Which project a command runs against, and the refusal when the credential cannot be pointed at
 * it. Drives the real in-memory credential context the way a request does, as the daemon relies on
 * it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as ProjectScopeModule from "../projectScope";

const projects = vi.hoisted(() => ({ resolve: vi.fn() }));

vi.mock("../projectScope", async (importOriginal) => {
  const actual = await importOriginal<typeof ProjectScopeModule>();
  return { ...actual, resolveProjectSelector: projects.resolve };
});

vi.mock("../identityNotice", () => ({ maybePrintIdentityNotice: vi.fn() }));

import {
  resetFallbackCredentialHolder,
  runWithCredentialHolder,
  scopedProjectId,
  setRequestedProject,
} from "@/internal/credentialContext";

import { resolveCredentials } from "../apiKey";
import { ProjectScopeError } from "../projectScope";

/** A user-scoped key: a lookup id and a secret, which the server pairs with a project. */
const USER_SCOPED = "sk-lw-lookup123_secret456";
/** A legacy project key: no lookup id, so the token itself carries the project. */
const PROJECT_KEY = "sk-lw-onlyonepart";

class ProcessExitError extends Error {}

/** One request, in its own credential holder, exactly as the daemon runs it. */
const inOneRequest = <T>(fn: () => Promise<T>): Promise<T> => runWithCredentialHolder(fn);

const whatWasSaid = (): string => vi.mocked(console.error).mock.calls.flat().join(" ");

beforeEach(() => {
  vi.clearAllMocks();
  resetFallbackCredentialHolder();
  projects.resolve.mockResolvedValue("project_resolved");
  delete process.env.LANGWATCH_PROJECT_ID;
  process.env.LANGWATCH_API_KEY = USER_SCOPED;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(process, "exit").mockImplementation(() => {
    throw new ProcessExitError();
  });
});

describe("given a user-scoped key", () => {
  /** @scenario "LANGWATCH_PROJECT_ID reaches the request for a user-scoped key" */
  it("lets LANGWATCH_PROJECT_ID reach the request without a listing lookup", async () => {
    process.env.LANGWATCH_PROJECT_ID = "project_from_env";

    await inOneRequest(() => resolveCredentials());

    // Unresolved on purpose: an id is what a personal access token is
    // documented to need, and looking it up would put a project listing in
    // front of every command and refuse a key allowed to read its own project
    // but not to list the organization's.
    expect(projects.resolve).not.toHaveBeenCalled();
  });

  /** @scenario "--project wins over LANGWATCH_PROJECT_ID" */
  it("takes the named project over the environment's", async () => {
    process.env.LANGWATCH_PROJECT_ID = "project_from_env";

    const { resolved, published } = await inOneRequest(async () => {
      const credentials = await resolveCredentials({
        project: "checkout-agent",
      });
      return { resolved: credentials, published: scopedProjectId() };
    });

    expect(projects.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ selector: "checkout-agent" }),
    );
    expect(resolved.projectId).toBe("project_resolved");
    expect(published).toBe("project_resolved");
  });

  it("reads the project the command line published when nothing was passed", async () => {
    const published = await inOneRequest(async () => {
      setRequestedProject("from-the-flag");
      await resolveCredentials();
      return scopedProjectId();
    });

    expect(projects.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ selector: "from-the-flag" }),
    );
    expect(published).toBe("project_resolved");
  });

  /** @scenario "a named project that matches nothing is refused before the request" */
  it("refuses a named project that matches nothing", async () => {
    projects.resolve.mockRejectedValue(
      new ProjectScopeError(
        "project_not_accessible",
        'no accessible project matches "nope".',
        "nope",
      ),
    );

    await expect(inOneRequest(() => resolveCredentials({ project: "nope" }))).rejects.toThrow(
      ProcessExitError,
    );

    expect(whatWasSaid()).toContain("nope");
  });
});

describe("given a key that carries its own project", () => {
  beforeEach(() => {
    process.env.LANGWATCH_API_KEY = PROJECT_KEY;
  });

  /** @scenario "--project against a key bound to one project is refused" */
  it("refuses a named project rather than answering from the key's own", async () => {
    await expect(
      inOneRequest(() => resolveCredentials({ project: "checkout-agent" })),
    ).rejects.toThrow(ProcessExitError);

    expect(whatWasSaid()).toContain("project key");
    expect(whatWasSaid()).toContain("langwatch login");
    expect(projects.resolve).not.toHaveBeenCalled();
  });

  /** @scenario "a stale LANGWATCH_PROJECT_ID beside a project key warns rather than fails" */
  it("warns but still runs when only the environment named a project", async () => {
    process.env.LANGWATCH_PROJECT_ID = "project_from_an_old_shell";

    const resolved = await inOneRequest(() => resolveCredentials());

    expect(resolved.apiKey).toBe(PROJECT_KEY);
    expect(whatWasSaid()).toContain("LANGWATCH_PROJECT_ID was ignored");
    expect(whatWasSaid()).toContain("the key's own project");
  });

  it("publishes no project, so the key's own is what answers", async () => {
    process.env.LANGWATCH_PROJECT_ID = "project_from_an_old_shell";

    const { resolved, published } = await inOneRequest(async () => {
      const credentials = await resolveCredentials();
      return { resolved: credentials, published: scopedProjectId() };
    });

    expect(resolved.projectId).toBeUndefined();
    expect(published).toBeUndefined();
  });

  /** @scenario "every request warns that LANGWATCH_PROJECT_ID was ignored" */
  it("warns every request, not only the first one the process served", async () => {
    process.env.LANGWATCH_PROJECT_ID = "project_from_an_old_shell";

    await inOneRequest(() => resolveCredentials());
    const afterFirst = whatWasSaid();
    vi.mocked(console.error).mockClear();
    await inOneRequest(() => resolveCredentials());

    expect(afterFirst).toContain("LANGWATCH_PROJECT_ID was ignored");
    expect(whatWasSaid()).toContain("LANGWATCH_PROJECT_ID was ignored");
  });

  it("says it once inside one request, however often the credential resolves", async () => {
    process.env.LANGWATCH_PROJECT_ID = "project_from_an_old_shell";

    await inOneRequest(async () => {
      await resolveCredentials();
      await resolveCredentials();
    });

    const warnings = vi
      .mocked(console.error)
      .mock.calls.flat()
      .filter(
        (line) => typeof line === "string" && line.includes("LANGWATCH_PROJECT_ID was ignored"),
      );
    expect(warnings).toHaveLength(1);
  });
});

describe("given a project key passed with --api-key", () => {
  /** @scenario "a project key given by flag is not blamed on the environment" */
  it("tells the user to drop the flag, not to unset a variable they never set", async () => {
    await expect(
      inOneRequest(() => resolveCredentials({ apiKey: PROJECT_KEY, project: "checkout-agent" })),
    ).rejects.toThrow(ProcessExitError);

    expect(whatWasSaid()).toContain("--api-key");
    expect(whatWasSaid()).not.toContain("LANGWATCH_API_KEY");
  });
});
