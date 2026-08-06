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
import type { CodingAgentSessionState } from "../../projections/codingAgentSession.foldProjection";
import type { CodingAgentProcessingEvent } from "../../schemas/events";
import { createPullRequestMappingReactor } from "../pullRequestMapping.reactor";

function foldState(
  over: Partial<CodingAgentSessionState> = {},
): CodingAgentSessionState {
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
    foldState: state,
  };
}

describe("pullRequestMapping reactor", () => {
  describe("given a session whose repository host is not github.com", () => {
    /** @scenario "A repository on a non-GitHub host never triggers a GitHub call" */
    it("requests no mapping", async () => {
      const requestBranchMapping = vi.fn().mockResolvedValue(undefined);
      const reactor = createPullRequestMappingReactor({
        requestBranchMapping,
      });
      const state = foldState({ repositoryHost: "gitlab.example.com" });

      expect(reactor.shouldReact?.(event, contextFor(state))).toBe(false);
      await reactor.handle(event, contextFor(state));

      expect(requestBranchMapping).not.toHaveBeenCalled();
    });
  });

  describe("given a session carrying a github.com repository and a branch", () => {
    it("requests the mapping for that branch", async () => {
      const requestBranchMapping = vi.fn().mockResolvedValue(undefined);
      const reactor = createPullRequestMappingReactor({
        requestBranchMapping,
      });
      const state = foldState();

      expect(reactor.shouldReact?.(event, contextFor(state))).toBe(true);
      await reactor.handle(event, contextFor(state));

      expect(requestBranchMapping).toHaveBeenCalledWith({
        tenantId: "project-1",
        repositoryHost: "github.com",
        repositoryOwner: "acme",
        repositoryName: "widgets",
        headBranch: "feat/linkage",
      });
    });

    it("treats an unreported host as github.com", () => {
      const reactor = createPullRequestMappingReactor({
        requestBranchMapping: vi.fn(),
      });

      expect(
        reactor.shouldReact?.(
          event,
          contextFor(foldState({ repositoryHost: "" })),
        ),
      ).toBe(true);
    });
  });

  describe("given a session with no git context", () => {
    it("requests no mapping", () => {
      const reactor = createPullRequestMappingReactor({
        requestBranchMapping: vi.fn(),
      });

      for (const missing of [
        { repositoryOwner: "" },
        { repositoryName: "" },
        { gitBranch: "" },
      ]) {
        expect(
          reactor.shouldReact?.(event, contextFor(foldState(missing))),
        ).toBe(false);
      }
    });
  });

  describe("when the mapping fails", () => {
    it("swallows the error so the queue does not retry against the same limit", async () => {
      const reactor = createPullRequestMappingReactor({
        requestBranchMapping: vi
          .fn()
          .mockRejectedValue(new Error("GitHub rate limit reached")),
      });

      await expect(
        reactor.handle(event, contextFor(foldState())),
      ).resolves.toBeUndefined();
    });
  });

  describe("its queue options", () => {
    it("keys the job on the project, repository and branch", () => {
      const reactor = createPullRequestMappingReactor({
        requestBranchMapping: vi.fn(),
      });

      const jobId = reactor.options?.makeJobId?.({
        event,
        foldState: foldState(),
      });

      expect(jobId).toBe("prmap:project-1:acme/widgets:feat/linkage");
      expect(reactor.options?.runIn).toEqual(["worker"]);
    });

    /**
     * The dedup contract, pinned. `makeJobId` + `ttl` alone does NOT collapse
     * anything: with no delay the job dispatches on the first event, dispatch
     * takes it out of staging, and every later event misses the lookup and
     * stages its own job. A non-zero delay is what gives the key something to
     * collapse into, so a future edit that drops it would silently return this
     * reactor to a GitHub-facing job per fold commit.
     */
    it("holds a real window so one branch's events collapse into one job", () => {
      const options = createPullRequestMappingReactor({
        requestBranchMapping: vi.fn(),
      }).options;

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
     * @scenario "Concurrent sessions on one branch ask GitHub once"
     */
    it("groups the job on the same branch its dedup id is keyed on", () => {
      const reactor = createPullRequestMappingReactor({
        requestBranchMapping: vi.fn(),
      });
      const first = { event, foldState: foldState() };
      const second = {
        event: { ...event, aggregateId: "session-2" },
        foldState: foldState(),
      };

      const groupKey = reactor.options?.groupKeyFn;
      expect(groupKey).toBeDefined();
      expect(groupKey?.(first)).toBe(groupKey?.(second));
      expect(groupKey?.(first)).toBe(reactor.options?.makeJobId?.(first));
    });

    it("keeps a different branch in its own group", () => {
      const reactor = createPullRequestMappingReactor({
        requestBranchMapping: vi.fn(),
      });

      expect(
        reactor.options?.groupKeyFn?.({ event, foldState: foldState() }),
      ).not.toBe(
        reactor.options?.groupKeyFn?.({
          event,
          foldState: foldState({ gitBranch: "feat/other" }),
        }),
      );
    });

    /**
     * A reactor's ready score is the event's own `createdAt`, so a backlogged
     * group stages jobs whose `createdAt + delay` deadline has already passed:
     * they dispatch immediately and the window collapses nothing. The TTL
     * outliving dispatch is what still holds the throttle there.
     *
     * @scenario "Concurrent sessions on one branch ask GitHub once"
     */
    it("holds the throttle past dispatch, for the window that already elapsed", () => {
      const options = createPullRequestMappingReactor({
        requestBranchMapping: vi.fn(),
      }).options;

      expect(options?.deduplication?.shouldSurviveDispatch).toBe(true);
    });
  });
});
