/**
 * @vitest-environment node
 * @unit
 *
 * The fold-side trigger: which folded sessions ask GitHub about their branch,
 * and what happens when the ask fails.
 *
 * @see specs/coding-agent/pull-request-linkage.feature
 */
import { describe, expect, it, vi } from "vitest";
import type { CodingAgentProcessingEvent } from "@langwatch/coding-agent-contract";
import type { CodingAgentSessionState } from "../../projections/coding-agent-session.projection";
import {
  createPullRequestMappingHandler,
  createPullRequestMappingSubscriber,
  shouldMapPullRequests,
} from "../pull-request-mapping.subscriber";
import { buildTestCodingAgentProcessingPipeline } from "../../adapters/__tests__/fixtures/coding-agent-processing.fixture";
import { TestGithubService } from "../../repositories/__tests__/fixtures/coding-agent.fixture";

function foldState(over: Partial<CodingAgentSessionState> = {}): CodingAgentSessionState {
  return {
    repositoryHost: "github.com",
    repositoryOwner: "acme",
    repositoryName: "widgets",
    gitBranch: "feat/linkage",
    ...over,
  } as CodingAgentSessionState;
}

const event = {
  tenantId: "project-1",
  aggregateId: "session-1",
} as unknown as CodingAgentProcessingEvent;

function contextFor(state: CodingAgentSessionState) {
  return {
    tenantId: "project-1",
    aggregateId: "session-1",
    state,
  };
}

/** The REAL pipeline registration — `build()` only stores references. */
function registrationWith(github = TestGithubService.create()) {
  return buildTestCodingAgentProcessingPipeline(github).foldSubscribers.get("pullRequestMapping")!
    .definition;
}

describe("pullRequestMapping subscriber", () => {
  describe("given the exported production definition", () => {
    it("owns the fold, worker placement, and backlog-safe throttle policy", () => {
      const subscriber = createPullRequestMappingSubscriber(TestGithubService.create());

      expect(subscriber).toMatchObject({
        fold: "codingAgentSession",
        runIn: ["worker"],
        delay: 30_000,
        dedup: {
          ttlMs: 30_000,
          extend: false,
          replace: true,
          shouldSurviveDispatch: true,
        },
      });
    });
  });

  describe("when the same folded branch is redelivered", () => {
    it("resolves to one durable branch-mapping identity", async () => {
      const github = TestGithubService.create();
      const handler = createPullRequestMappingHandler(github);
      const state = foldState();

      await handler(event, contextFor(state));
      await handler(event, contextFor(state));

      const durable = new Map(
        github.mappingRequests.map((request) => [
          `${request.tenantId}:${request.repositoryOwner.toLowerCase()}/${request.repositoryName.toLowerCase()}:${request.headBranch}`,
          request,
        ]),
      );
      expect(github.mappingRequests).toHaveLength(2);
      expect(durable.size).toBe(1);
    });
  });

  describe("given a session whose repository host is not the instance's GitHub host", () => {
    /** @scenario "A repository on a host this instance cannot answer for never triggers a GitHub call" */
    it("requests no mapping", async () => {
      const github = TestGithubService.create();
      const requestBranchMapping = vi.spyOn(github, "requestBranchMapping");
      const handler = createPullRequestMappingHandler(github);
      const state = foldState({ repositoryHost: "gitlab.example.com" });

      expect(shouldMapPullRequests(state, github)).toBe(false);
      await handler(event, contextFor(state));

      expect(requestBranchMapping).not.toHaveBeenCalled();
    });
  });

  describe("given a session carrying a github.com repository and a branch", () => {
    it("requests the mapping for that branch", async () => {
      const github = TestGithubService.create();
      const requestBranchMapping = vi.spyOn(github, "requestBranchMapping");
      const handler = createPullRequestMappingHandler(github);
      const state = foldState();

      expect(shouldMapPullRequests(state, github)).toBe(true);
      await handler(event, contextFor(state));

      expect(requestBranchMapping).toHaveBeenCalledWith({
        tenantId: "project-1",
        repositoryHost: "github.com",
        repositoryOwner: "acme",
        repositoryName: "widgets",
        headBranch: "feat/linkage",
      });
    });

    it("treats an unreported host as github.com", () => {
      const github = TestGithubService.create();
      expect(shouldMapPullRequests(foldState({ repositoryHost: "" }), github)).toBe(true);
    });

    // A session records whatever casing its git remote carries, and every
    // reader downstream folds the host before looking the mapping up. A gate
    // that refuses this spelling means those readers look for a row nothing
    // ever wrote, and the branch reads as having no pull request forever.
    /** @scenario "A session whose remote host casing differs still finds its pull request" */
    it("treats a differently cased github.com as github.com", () => {
      const github = TestGithubService.create();
      expect(shouldMapPullRequests(foldState({ repositoryHost: "GitHub.com" }), github)).toBe(true);
    });
  });

  describe("given a session with no git context", () => {
    it("requests no mapping", () => {
      const github = TestGithubService.create();
      for (const missing of [{ repositoryOwner: "" }, { repositoryName: "" }, { gitBranch: "" }]) {
        expect(shouldMapPullRequests(foldState(missing), github)).toBe(false);
      }
    });
  });

  describe("when the mapping fails", () => {
    it("swallows the error so the queue does not retry against the same limit", async () => {
      const github = TestGithubService.create();
      github.mappingError = new Error("GitHub rate limit reached");
      const handler = createPullRequestMappingHandler(github);

      await expect(handler(event, contextFor(foldState()))).resolves.toBeUndefined();
    });
  });

  describe("given the queue options on its pipeline registration", () => {
    it("keys the job on the project, repository and branch", () => {
      const registration = registrationWith();

      const jobId = registration.options?.makeJobId?.({
        event,
        // A session records the casing its git remote carries, and the mapping
        // service's durable claim resolves it lowercased. The key folds to
        // match, so the throttle counts the one repository the claim counts.
        foldState: foldState({
          repositoryOwner: "Acme",
          repositoryName: "Widgets",
        }),
      });

      expect(jobId).toBe("subscriber:pullRequestMapping:prmap:project-1:acme/widgets:feat/linkage");
      expect(registration.options?.runIn).toEqual(["worker"]);
    });

    /**
     * The dedup contract, pinned. A dedup key + ttl alone does NOT collapse
     * anything: with no delay the job dispatches on the first event, dispatch
     * takes it out of staging, and every later event misses the lookup and
     * stages its own job. A non-zero delay is what gives the key something to
     * collapse into, so a future edit that drops it would silently return this
     * subscriber to a GitHub-facing job per fold commit.
     */
    it("holds a real window so one branch's events collapse into one job", () => {
      const options = registrationWith().options;

      expect(options?.delay).toBeGreaterThan(0);
      expect(options?.deduplication).toBeDefined();
      expect(options?.deduplication?.ttlMs).toBeGreaterThan(0);
      // Pinned against the newest event would defer a streaming session's job
      // forever; the deadline belongs to the event that opened the window.
      expect(options?.deduplication?.extend).toBe(false);
      expect(options?.deduplication?.replace).toBe(true);
      // The router collapses by makeJobId before staging, the queue squashes by
      // deduplication.makeId after. The two disagreeing stages duplicates.
      expect(options?.deduplication?.makeId).toBe(options?.makeJobId);
    });

    /**
     * The dedup key is queue-global; the squash it protects is conditional on
     * the existing job having a rank in the NEW payload's own group. Grouping
     * on anything but the branch — the default is per session — puts two
     * worktrees' folds in two groups, the rank lookup misses, and the script
     * reads the miss as "already dispatched". Both the key and the group must
     * name the same thing.
     *
     * The second worktree here names the repository in its remote's own casing,
     * because two clones of one repository need not agree on it and the group
     * has to fold the way the mapping service's claim does.
     *
     * @scenario "Concurrent sessions on one branch ask GitHub once"
     */
    it("groups the job on the same branch its dedup id is keyed on", () => {
      const registration = registrationWith();
      const first = { event, foldState: foldState() };
      const second = {
        event: { ...event, aggregateId: "session-2" },
        foldState: foldState({
          repositoryOwner: "Acme",
          repositoryName: "Widgets",
        }),
      };

      const groupKey = registration.options?.groupKeyFn;
      expect(groupKey).toBeDefined();
      expect(groupKey?.(first)).toBe(groupKey?.(second));
      // The dedup id embeds the same branch key the group is keyed on — the
      // subscriber prefix on the dedup id changes the string, never the unit
      // of work the two describe.
      expect(registration.options?.makeJobId?.(first)).toContain(groupKey!(first));
    });

    it("keeps a different branch in its own group", () => {
      const registration = registrationWith();
      const groupKey = registration.options?.groupKeyFn;

      expect(groupKey?.({ event, foldState: foldState() })).not.toBe(
        groupKey?.({
          event,
          foldState: foldState({ gitBranch: "feat/other" }),
        }),
      );
      // The repository folds and the branch does not: `feat/X` and `feat/x` are
      // two branches, and collapsing them would map one and leave the other
      // looking like it has no pull request.
      expect(groupKey?.({ event, foldState: foldState() })).not.toBe(
        groupKey?.({
          event,
          foldState: foldState({ gitBranch: "feat/Linkage" }),
        }),
      );
    });

    /**
     * A subscriber's ready score is the event's own `createdAt`, so a
     * backlogged group stages jobs whose `createdAt + delay` deadline has
     * already passed: they dispatch immediately and the window collapses
     * nothing. The TTL outliving dispatch is what still holds the throttle
     * there.
     *
     * @scenario "Concurrent sessions on one branch ask GitHub once"
     */
    it("holds the throttle past dispatch, for the window that already elapsed", () => {
      const options = registrationWith().options;

      expect(options?.deduplication?.shouldSurviveDispatch).toBe(true);
    });
  });
});
