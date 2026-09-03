/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { GithubPullRequestEventAdapter } from "../github-pull-request-event.adapter";

const protocol = GithubPullRequestEventAdapter.create();
const parseGithubPullRequestEvent = (payload: unknown) => protocol.tryParse(payload);

function delivery(overrides: Record<string, unknown> = {}) {
  return {
    action: "opened",
    installation: { id: 4242 },
    repository: {
      name: "widgets",
      full_name: "acme/widgets",
      owner: { login: "acme" },
    },
    pull_request: {
      number: 7,
      html_url: "https://github.com/acme/widgets/pull/7",
      title: "Link sessions to pull requests",
      state: "open",
      draft: false,
      merged_at: null,
      closed_at: null,
      created_at: "2026-08-01T10:00:00.000Z",
      updated_at: "2026-08-01T11:00:00.000Z",
      user: { login: "someone" },
      head: { ref: "feat/linkage", repo: { full_name: "acme/widgets" } },
    },
    ...overrides,
  };
}

describe("GitHub pull-request webhook parsing", () => {
  it("normalizes the GitHub payload into the mapping event the service persists", () => {
    expect(parseGithubPullRequestEvent(delivery())).toEqual({
      action: "opened",
      installationId: "4242",
      repositoryOwner: "acme",
      repositoryName: "widgets",
      headBranch: "feat/linkage",
      pullRequest: {
        number: 7,
        htmlUrl: "https://github.com/acme/widgets/pull/7",
        title: "Link sessions to pull requests",
        state: "open",
        draft: false,
        mergedAt: null,
        closedAt: null,
        createdAt: "2026-08-01T10:00:00.000Z",
        updatedAt: "2026-08-01T11:00:00.000Z",
        authorLogin: "someone",
      },
    });
  });

  it("rejects absent or malformed source ordering times", () => {
    const pullRequest = delivery().pull_request as Record<string, unknown>;
    const { updated_at: _updatedAt, ...withoutUpdatedAt } = pullRequest;
    const malformed = {
      ...pullRequest,
      updated_at: "yesterday",
    };

    expect(parseGithubPullRequestEvent(delivery({ pull_request: withoutUpdatedAt }))).toBeNull();
    expect(parseGithubPullRequestEvent(delivery({ pull_request: malformed }))).toBeNull();
  });

  it("retains an offset source ordering time", () => {
    const pullRequest = delivery().pull_request as Record<string, unknown>;
    const parsed = parseGithubPullRequestEvent(
      delivery({
        pull_request: {
          ...pullRequest,
          updated_at: "2026-08-01T13:00:00+02:00",
        },
      }),
    );

    expect(parsed?.pullRequest.updatedAt).toBe("2026-08-01T13:00:00+02:00");
  });

  it("rejects forked or deleted head repositories", () => {
    const pullRequest = delivery().pull_request as Record<string, unknown>;
    const forked = {
      ...pullRequest,
      head: { ref: "feat/linkage", repo: { full_name: "contributor/widgets" } },
    };
    const deletedHead = {
      ...pullRequest,
      head: { ref: "feat/linkage", repo: null },
    };

    expect(parseGithubPullRequestEvent(delivery({ pull_request: forked }))).toBeNull();
    expect(parseGithubPullRequestEvent(delivery({ pull_request: deletedHead }))).toBeNull();
  });

  it("rejects an unrecognizable payload or one without an installation", () => {
    expect(parseGithubPullRequestEvent({ zen: "hi" })).toBeNull();
    expect(parseGithubPullRequestEvent(null)).toBeNull();
    expect(parseGithubPullRequestEvent(delivery({ installation: null }))).toBeNull();
  });
});
