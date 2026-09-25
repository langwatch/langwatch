/**
 * The maintenance sweeps are REGISTERED, not merely defined.
 *
 * This exists because of the exact failure it guards: the Langy session-key
 * reaper was written, unit-tested and routed for cron — and never invoked,
 * because the chart ships no CronJobs. Every test passed while the backstop it
 * provides did not run at all. A pipeline's own unit tests say nothing about
 * whether anything mounts it, so without this, deleting the `register(...)`
 * call reintroduces that regression silently.
 *
 * `registerAll` needs a deps surface far too large to build honestly here, so
 * the stub auto-vivifies: any property is a callable that returns another such
 * proxy. The trace command's dynamic database lookup is mocked below so the
 * run reaches the identity owners before the expected later failure.
 */

import { createScimSyncPipeline } from "@ee/event-sourcing/pipelines/scim-sync/pipeline";
import { SCIM_REQUEST_LOG_RETENTION_PROCESS_NAME } from "@ee/event-sourcing/pipelines/scim-sync/process-manager/scim-request-log-retention-sweep.process";
import { createSsoConnectionPipeline } from "@ee/event-sourcing/pipelines/sso-connections/pipeline";
import { BREAK_GLASS_EXPIRY_WARN_PROCESS_NAME } from "@ee/event-sourcing/pipelines/sso-connections/process-manager/break-glass-expiry-warn.process";
import { SSO_DOMAIN_PROOF_NOTIFICATION_PROCESS_NAME } from "@ee/event-sourcing/pipelines/sso-connections/process-manager/sso-domain-proof-notification.process";
import { SSO_DOMAIN_REPROOF_SWEEP_PROCESS_NAME } from "@ee/event-sourcing/pipelines/sso-connections/process-manager/sso-domain-reproof-sweep.process";
import { describe, expect, it, vi } from "vitest";
import { buildIntentFactories } from "../pipeline/processManagerDefinition";
import { PipelineRegistry } from "../pipelineRegistry";

// The registration fixture reaches the trace pipeline after the maintenance
// registrations. Its zero-argument command constructor resolves the app's
// database module dynamically, which is outside this registration test's
// scope; keep the fixture able to reach the later owner pipelines.
vi.mock("../pipelines/trace-processing/commands/recordSpanCommand", () => ({
  RECORD_SPAN_DEDUPLICATION: {
    makeId: () => "stub",
    ttlMs: 30_000,
    extend: true,
    replace: true,
  },
  RecordSpanCommand: class RecordSpanCommand {},
}));

function ownerPipelines() {
  const ssoConnections = createSsoConnectionPipeline({
    connectionProjectionStore: autoStub(),
    connectionGuards: autoStub(),
    teardown: autoStub(),
    expiryWarn: {
      warn: async () => ({ warned: 0 }),
      deleteDispatchedBefore: async () => 0,
    },
    domainReproof: {
      sweep: async () => ({
        checked: 0,
        wavered: 0,
        lapsed: 0,
        recovered: 0,
        unreachable: 0,
        failed: [],
        truncated: false,
      }),
      deleteDispatchedBefore: async () => 0,
    },
    domainProofNotifications: {
      prepare: async () => undefined,
      fanout: async () => undefined,
      send: async () => undefined,
    },
  });
  const scimSync = createScimSyncPipeline({
    scimSyncProjectionStore: autoStub(),
    scimSyncGuards: autoStub(),
    logRetention: {
      sweep: async () => 0,
      deleteDispatchedBefore: async () => 0,
    },
  });

  return { ssoConnections, scimSync };
}

/** A permissive stand-in: every access yields something callable and chainable. */
function autoStub(): any {
  const fn = () => autoStub();
  return new Proxy(fn, {
    get: (_t, prop) => {
      if (prop === "then") return undefined; // never look thenable to `await`
      if (prop === Symbol.toPrimitive) return () => "stub";
      return autoStub();
    },
    apply: () => autoStub(),
  });
}

function registeredPipelineNames(): string[] {
  const register = vi.fn(
    (pipeline: { name?: string; metadata?: { name?: string } }) => {
      // `build()` puts the name on `metadata`; read both so the guard survives
      // either shape rather than silently matching nothing.
      names.push(pipeline?.metadata?.name ?? pipeline?.name ?? "<unnamed>");
      return autoStub();
    },
  );
  const names: string[] = [];

  const deps = new Proxy(
    { eventSourcing: { register } } as Record<string, unknown>,
    {
      get: (target, prop) =>
        prop in target ? (target as any)[prop] : autoStub(),
    },
  );

  try {
    new PipelineRegistry(deps as never).registerAll();
  } catch {
    // Expected: the stub cannot satisfy every dependency to the end of the
    // method. What matters is which pipelines were registered before that.
  }
  return names;
}

describe("PipelineRegistry.registerAll", () => {
  describe("given the maintenance sweeps that nothing else would invoke", () => {
    describe("when the registry wires up its pipelines", () => {
      it("mounts the Langy session-key reaper", () => {
        expect(registeredPipelineNames()).toContain("langy_maintenance");
      });

      it("mounts the agent sandbox key reaper", () => {
        // Nothing revokes a sandbox key at the end of a run, so an unmounted
        // sweep leaves every key of every run live until it expires.
        expect(registeredPipelineNames()).toContain(
          "agent_sandbox_maintenance",
        );
      });

      it("mounts the CLI login key reaper", () => {
        // A session the CLI stops refreshing leaves Redis by TTL, which runs
        // no code, so an unmounted sweep leaves its login key and every
        // ingest key under it live for good.
        expect(registeredPipelineNames()).toContain(
          "cli_login_key_maintenance",
        );
      });

      it("mounts the blob-maintenance sweep alongside it", () => {
        // Same class of defect, same guard: a scheduled sweep with no caller
        // is indistinguishable from a working one until the thing it protects
        // against actually happens.
        expect(registeredPipelineNames()).toContain("blob_maintenance");
      });

      /**
       * The GitHub branch recheck moved off a per-replica `setTimeout` and onto
       * this schedule. If the registration is ever dropped, the sweep stops
       * running entirely and nothing else notices: pull requests opened after a
       * session goes quiet simply never get linked, which looks like a mapping
       * bug rather than a missing caller.
       *
       * @scenario "The recheck sweep runs once per fleet, not once per replica"
       */
      it("mounts the GitHub branch recheck and retention sweep", () => {
        expect(registeredPipelineNames()).toContain("github_maintenance");
      });

      it("registers the SSO maintenance processes through one owner pipeline", () => {
        const names = registeredPipelineNames();

        expect(names.filter((name) => name === "sso-connections")).toHaveLength(
          1,
        );
        expect(names).not.toContain("break_glass_maintenance");
        expect(names).not.toContain("sso_domain_reproof_maintenance");
      });

      it("registers SCIM request retention through its owner pipeline", () => {
        const names = registeredPipelineNames();

        expect(names.filter((name) => name === "scim-sync")).toHaveLength(1);
        expect(names).not.toContain("scim_request_log_maintenance");
      });
    });
  });
});

describe("maintenance process ownership", () => {
  it("mounts each process exactly once under its owning pipeline", () => {
    const { ssoConnections, scimSync } = ownerPipelines();

    expect([...ssoConnections.processManagers.keys()]).toEqual([
      "connectionTeardown",
      BREAK_GLASS_EXPIRY_WARN_PROCESS_NAME,
      SSO_DOMAIN_REPROOF_SWEEP_PROCESS_NAME,
      SSO_DOMAIN_PROOF_NOTIFICATION_PROCESS_NAME,
    ]);
    expect([...scimSync.processManagers.keys()]).toEqual([
      SCIM_REQUEST_LOG_RETENTION_PROCESS_NAME,
    ]);
  });

  it("keeps scheduled process keys stable across the owner move", () => {
    const { ssoConnections, scimSync } = ownerPipelines();
    const breakGlass = processManagerOrThrow(
      ssoConnections,
      BREAK_GLASS_EXPIRY_WARN_PROCESS_NAME,
    );
    const domainReproof = processManagerOrThrow(
      ssoConnections,
      SSO_DOMAIN_REPROOF_SWEEP_PROCESS_NAME,
    );
    const domainProofNotification = processManagerOrThrow(
      ssoConnections,
      SSO_DOMAIN_PROOF_NOTIFICATION_PROCESS_NAME,
    );
    const retention = processManagerOrThrow(
      scimSync,
      SCIM_REQUEST_LOG_RETENTION_PROCESS_NAME,
    );

    expect(breakGlass.config.schedule).toEqual({
      everyMs: 60 * 60 * 1000,
    });
    expect(domainReproof.config.schedule).toEqual({
      everyMs: 8 * 60 * 60 * 1000,
    });
    expect(retention.config.schedule).toEqual({
      everyMs: 6 * 60 * 60 * 1000,
    });

    expect(breakGlass.config.outbox).toMatchObject({
      leaseDurationMs: 5 * 60 * 1000,
      maxAttempts: 1,
    });
    expect(domainReproof.config.outbox).toMatchObject({
      leaseDurationMs: 15 * 60 * 1000,
      maxAttempts: 3,
    });
    expect(domainProofNotification.config.schedule).toBeUndefined();
    expect(domainProofNotification.config.outbox).toMatchObject({
      leaseDurationMs: 5 * 60 * 1000,
      maxAttempts: 10,
    });
    expect(retention.config.outbox).toMatchObject({
      leaseDurationMs: 15 * 60 * 1000,
      maxAttempts: 3,
    });

    const breakGlassFactories = buildIntentFactories(
      breakGlass.config.intents,
      { processKey: BREAK_GLASS_EXPIRY_WARN_PROCESS_NAME },
    );
    const domainReproofFactories = buildIntentFactories(
      domainReproof.config.intents,
      { processKey: SSO_DOMAIN_REPROOF_SWEEP_PROCESS_NAME },
    );
    const domainProofNotificationFactories = buildIntentFactories(
      domainProofNotification.config.intents,
      { processKey: "notification:notice-123" },
    );
    const retentionFactories = buildIntentFactories(retention.config.intents, {
      processKey: SCIM_REQUEST_LOG_RETENTION_PROCESS_NAME,
    });

    const breakGlassWarn = breakGlassFactories.warn;
    const domainReproofSweep = domainReproofFactories.sweep;
    const domainProofPrepare = domainProofNotificationFactories.prepare;
    const retentionSweep = retentionFactories.sweep;
    if (
      !breakGlassWarn ||
      !domainReproofSweep ||
      !domainProofPrepare ||
      !retentionSweep
    ) {
      throw new Error("maintenance intent factory is missing");
    }

    const breakGlassIntent = breakGlassWarn("warn:123", {
      scheduledFor: 123,
    });
    const domainReproofIntent = domainReproofSweep("sweep:123", {
      scheduledFor: 123,
    });
    const domainProofIntent = domainProofPrepare("prepare:123", {
      kind: "lapsed",
      notificationId: "notice-123",
      connectionId: "connection-123",
      organizationId: "organization-123",
      domain: "acme.test",
    });
    const retentionIntent = retentionSweep("sweep:123", {
      scheduledFor: 123,
    });

    expect(breakGlassIntent.messageKey).toBe(
      "process:breakGlassExpiryWarn:warn:123",
    );
    expect(domainReproofIntent.messageKey).toBe(
      "process:ssoDomainReproofSweep:sweep:123",
    );
    expect(domainProofIntent.messageKey).toBe(
      "process:notification%3Anotice-123:prepare:123",
    );
    expect(retentionIntent.messageKey).toBe(
      "process:scimRequestLogRetention:sweep:123",
    );
    expect(retentionSweep("sweep:123", { scheduledFor: 123 }).messageKey).toBe(
      retentionIntent.messageKey,
    );
  });
});

function processManagerOrThrow(
  pipeline:
    | ReturnType<typeof ownerPipelines>["ssoConnections"]
    | ReturnType<typeof ownerPipelines>["scimSync"],
  name: string,
) {
  const processManager = pipeline.processManagers.get(name);
  if (!processManager) {
    throw new Error(`Process manager ${name} is not mounted`);
  }
  return processManager;
}
