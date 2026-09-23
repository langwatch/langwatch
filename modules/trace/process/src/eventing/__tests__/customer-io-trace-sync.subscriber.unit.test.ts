import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => logger,
}));

import type { OrgAdminResolution } from "@langwatch/project-contract";

import type { TraceProjectMetadata } from "../../app/trace.members.ts";
import {
  CIO_TRACE_SYNC_DEBOUNCE_MS,
  createCustomerIoTraceSyncHandler,
  customerIoTraceSyncJobId,
  resetCustomerIoTraceSyncDebounceCache,
  type CustomerIoTraceSyncSubscriberDeps,
} from "../customer-io-trace-sync.subscriber.ts";
import {
  createContext,
  createFoldState,
  createTraceEvent,
  TENANT_ID,
} from "./trace-subscriber.fixtures.ts";

function createAdminResolution(overrides: Partial<OrgAdminResolution> = {}): OrgAdminResolution {
  return {
    userId: "user-1",
    organizationId: "org-1",
    firstMessage: false,
    onboardingVariant: null,
    organizationCreatedAt: null,
    ...overrides,
  };
}

/**
 * The `resolveOrgAdmin` mock travels separately from `projects`: reading it
 * back off the interface-typed object trips the unbound-method lint, since
 * `TraceProjectMetadata` declares it with method-shorthand syntax.
 */
function createMockProjects(resolution: OrgAdminResolution) {
  const resolveOrgAdmin = vi.fn().mockResolvedValue(resolution);
  const projects: TraceProjectMetadata = {
    findById: vi.fn().mockResolvedValue(null),
    updateMetadata: vi.fn().mockResolvedValue(undefined),
    resolveOrgAdmin,
  };
  return { projects, resolveOrgAdmin };
}

function createDeps(
  overrides: {
    projects?: TraceProjectMetadata;
    resolution?: Partial<OrgAdminResolution>;
    traceSync?: CustomerIoTraceSyncSubscriberDeps["traceSync"];
  } = {},
) {
  const mocked = createMockProjects(createAdminResolution(overrides.resolution));
  const deps = {
    projects: overrides.projects ?? mocked.projects,
    traceSync: overrides.traceSync ?? {
      fireFirstTraceIntegrated: vi.fn(),
      identifySubsequentTrace: vi.fn(),
    },
  } satisfies CustomerIoTraceSyncSubscriberDeps;
  return { deps, resolveOrgAdmin: mocked.resolveOrgAdmin };
}

describe("createCustomerIoTraceSyncHandler()", () => {
  beforeEach(() => {
    logger.error.mockClear();
    logger.warn.mockClear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T12:00:00Z"));
    resetCustomerIoTraceSyncDebounceCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when deriving the customerIoTraceSyncJobId", () => {
    /** @scenario "Trace sync subscriber uses project-scoped job ID for debouncing" */
    it("returns cio-trace-sync-{projectId}", () => {
      expect(customerIoTraceSyncJobId("project-42")).toBe("cio-trace-sync-project-42");
    });
  });

  describe("given a project that has never received a trace", () => {
    describe("when the first trace is processed", () => {
      /** @scenario "First trace identifies user with trace milestones" */
      /** @scenario "First trace fires first_trace_integrated event" */
      /** @scenario "First trace fires immediately without debouncing" */
      it("fires the first-trace milestone with the sdk attributes and no debounce wait", async () => {
        const { deps } = createDeps();
        const handler = createCustomerIoTraceSyncHandler(deps);
        const traceTime = new Date("2026-03-15T10:00:00Z").getTime();
        const state = createFoldState({
          occurredAt: traceTime,
          attributes: {
            "langwatch.origin": "application",
            "sdk.language": "python",
            "langwatch.sdk.framework": "openai",
          },
        });

        await handler(createTraceEvent("lw.obs.trace.span_received"), createContext(state));

        expect(deps.traceSync.fireFirstTraceIntegrated).toHaveBeenCalledWith({
          userId: "user-1",
          projectId: TENANT_ID,
          sdkLanguage: "python",
          sdkFramework: "openai",
          traceOccurredAt: "2026-03-15T10:00:00.000Z",
        });
        expect(deps.traceSync.identifySubsequentTrace).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a project whose first trace is one of Langy's own turns", () => {
    /** @scenario "Langy's own turn does not reach Customer.io as a first trace" */
    it("makes no nurturing call at all", async () => {
      const { deps, resolveOrgAdmin } = createDeps();
      const handler = createCustomerIoTraceSyncHandler(deps);
      const state = createFoldState({ attributes: { "langwatch.origin": "langy" } });

      await handler(createTraceEvent("lw.obs.trace.span_received"), createContext(state));

      expect(resolveOrgAdmin).not.toHaveBeenCalled();
      expect(deps.traceSync.fireFirstTraceIntegrated).not.toHaveBeenCalled();
      expect(deps.traceSync.identifySubsequentTrace).not.toHaveBeenCalled();
    });
  });

  describe("given a project that already has traces", () => {
    describe("when a new trace is processed", () => {
      /** @scenario "Subsequent traces update count and timestamp with debouncing" */
      it("identifies the user with the trace timestamp", async () => {
        const { deps } = createDeps({ resolution: { firstMessage: true } });
        const handler = createCustomerIoTraceSyncHandler(deps);
        const traceTime = new Date("2026-03-15T10:00:00Z").getTime();
        const state = createFoldState({ occurredAt: traceTime });

        await handler(createTraceEvent("lw.obs.trace.span_received"), createContext(state));

        expect(deps.traceSync.identifySubsequentTrace).toHaveBeenCalledWith({
          userId: "user-1",
          traceOccurredAt: "2026-03-15T10:00:00.000Z",
        });
        expect(deps.traceSync.fireFirstTraceIntegrated).not.toHaveBeenCalled();
      });

      /** @scenario "Subsequent traces update count and timestamp with debouncing" */
      it("debounces a second identify within the five-minute window", async () => {
        const { deps } = createDeps({ resolution: { firstMessage: true } });
        const handler = createCustomerIoTraceSyncHandler(deps);
        const state = createFoldState();

        await handler(createTraceEvent("lw.obs.trace.span_received"), createContext(state));
        vi.setSystemTime(
          new Date("2026-03-15T12:00:00Z").getTime() + CIO_TRACE_SYNC_DEBOUNCE_MS - 1,
        );
        await handler(createTraceEvent("lw.obs.trace.span_received"), createContext(state));

        expect(deps.traceSync.identifySubsequentTrace).toHaveBeenCalledTimes(1);
      });

      it("identifies again once the debounce window has passed", async () => {
        const { deps } = createDeps({ resolution: { firstMessage: true } });
        const handler = createCustomerIoTraceSyncHandler(deps);
        const state = createFoldState();

        await handler(createTraceEvent("lw.obs.trace.span_received"), createContext(state));
        vi.setSystemTime(
          new Date("2026-03-15T12:00:00Z").getTime() + CIO_TRACE_SYNC_DEBOUNCE_MS + 1,
        );
        await handler(createTraceEvent("lw.obs.trace.span_received"), createContext(state));

        expect(deps.traceSync.identifySubsequentTrace).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe("given no admin user is found", () => {
    it("makes no nurturing call", async () => {
      const { deps } = createDeps({ resolution: { userId: null } });
      const handler = createCustomerIoTraceSyncHandler(deps);

      await handler(
        createTraceEvent("lw.obs.trace.span_received"),
        createContext(createFoldState()),
      );

      expect(deps.traceSync.fireFirstTraceIntegrated).not.toHaveBeenCalled();
      expect(deps.traceSync.identifySubsequentTrace).not.toHaveBeenCalled();
    });
  });

  describe("given resolveOrgAdmin throws", () => {
    it("swallows the error (non-fatal)", async () => {
      const projects: TraceProjectMetadata = {
        findById: vi.fn().mockResolvedValue(null),
        updateMetadata: vi.fn().mockResolvedValue(undefined),
        resolveOrgAdmin: vi.fn().mockRejectedValue(new Error("db down")),
      };
      const { deps } = createDeps({ projects });
      const handler = createCustomerIoTraceSyncHandler(deps);

      await expect(
        handler(createTraceEvent("lw.obs.trace.span_received"), createContext(createFoldState())),
      ).resolves.toBeUndefined();
      expect(logger.error).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the first trace is detected via the resolved firstMessage flag", () => {
    /** @scenario "Trace sync does not duplicate first-trace detection logic" */
    it("reads firstMessage from resolveOrgAdmin rather than re-detecting it", async () => {
      const { deps, resolveOrgAdmin } = createDeps();
      const handler = createCustomerIoTraceSyncHandler(deps);

      await handler(
        createTraceEvent("lw.obs.trace.span_received"),
        createContext(createFoldState()),
      );

      expect(resolveOrgAdmin).toHaveBeenCalledWith(TENANT_ID);
    });
  });
});
