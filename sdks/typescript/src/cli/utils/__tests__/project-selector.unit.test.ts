/**
 * Which project a command runs against, and what happens when the credential
 * in hand cannot be pointed at the one that was named.
 *
 * `LANGWATCH_PROJECT_ID` used to reach `buildAuthHeaders` unresolved, where a
 * user-scoped key put it in the Basic header and a legacy project key dropped
 * it without a word. Setting it to a project id that existed, to one that did
 * not, and leaving it unset all produced the same rows, and nothing on screen
 * said which project had answered.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const scope = vi.hoisted(() => ({
  requested: vi.fn<() => string | undefined>(() => undefined),
  setProjectId: vi.fn(),
  setApiKey: vi.fn(),
}));

const projects = vi.hoisted(() => ({ resolve: vi.fn() }));

vi.mock("@/internal/credentialContext", () => ({
  requestedProject: scope.requested,
  setResolvedApiKey: scope.setApiKey,
  setResolvedProjectId: scope.setProjectId,
}));

vi.mock("../projectScope", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, resolveProjectSelector: projects.resolve };
});

vi.mock("../identityNotice", () => ({ maybePrintIdentityNotice: vi.fn() }));

import { resolveCredentials } from "../apiKey";
import { ProjectScopeError } from "../projectScope";

/** A user-scoped key: a lookup id and a secret, which the server pairs with a project. */
const USER_SCOPED = "sk-lw-lookup123_secret456";
/** A legacy project key: no lookup id, so the token itself carries the project. */
const PROJECT_KEY = "sk-lw-onlyonepart";

class ProcessExitError extends Error {}

beforeEach(() => {
  vi.clearAllMocks();
  scope.requested.mockReturnValue(undefined);
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

    await resolveCredentials();

    // Unresolved on purpose: an id is what a personal access token is
    // documented to need, and looking it up would put a project listing in
    // front of every command and refuse a key allowed to read its own project
    // but not to list the organization's.
    expect(projects.resolve).not.toHaveBeenCalled();
  });

  /** @scenario "--project wins over LANGWATCH_PROJECT_ID" */
  it("takes the named project over the environment's", async () => {
    process.env.LANGWATCH_PROJECT_ID = "project_from_env";

    await resolveCredentials({ project: "checkout-agent" });

    expect(projects.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ selector: "checkout-agent" }),
    );
    expect(scope.setProjectId).toHaveBeenCalledWith("project_resolved");
  });

  it("reads the project the command line published when nothing was passed", async () => {
    scope.requested.mockReturnValue("from-the-flag");

    await resolveCredentials();

    expect(projects.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ selector: "from-the-flag" }),
    );
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

    await expect(resolveCredentials({ project: "nope" })).rejects.toThrow();

    const said = vi.mocked(console.error).mock.calls.flat().join(" ");
    expect(said).toContain("nope");
  });
});

describe("given a key that carries its own project", () => {
  beforeEach(() => {
    process.env.LANGWATCH_API_KEY = PROJECT_KEY;
  });

  /** @scenario "--project against a key bound to one project is refused" */
  it("refuses a named project rather than answering from the key's own", async () => {
    await expect(
      resolveCredentials({ project: "checkout-agent" }),
    ).rejects.toThrow(ProcessExitError);

    const said = vi.mocked(console.error).mock.calls.flat().join(" ");
    expect(said).toContain("project key");
    expect(said).toContain("langwatch login");
    expect(projects.resolve).not.toHaveBeenCalled();
  });

  /** @scenario "a stale LANGWATCH_PROJECT_ID beside a project key warns rather than fails" */
  it("warns but still runs when only the environment named a project", async () => {
    process.env.LANGWATCH_PROJECT_ID = "project_from_an_old_shell";

    const resolved = await resolveCredentials();

    expect(resolved.apiKey).toBe(PROJECT_KEY);
    const said = vi.mocked(console.error).mock.calls.flat().join(" ");
    expect(said).toContain("LANGWATCH_PROJECT_ID was ignored");
    expect(said).toContain("the key's own project");
  });

  it("publishes no project, so the key's own is what answers", async () => {
    process.env.LANGWATCH_PROJECT_ID = "project_from_an_old_shell";

    await resolveCredentials();

    expect(scope.setProjectId).toHaveBeenCalledWith(undefined);
  });
});
