/**
 * The API process's half of the ADR-022 claim check: the per-project switch,
 * the size check behind it, and what a deployment with no object store does
 * instead.
 */
import { AwsClientProcessRuntime, OutboundProxyResolverPort } from "@langwatch/aws-client";
import {
  FeatureFlagService,
  type FeatureFlagKey,
  type FeatureFlagTarget,
} from "@langwatch/feature-flag-contract";
import type { StoredObjectStorageDestination } from "@langwatch/stored-object-contract";
import {
  StoredObjectProjectDestinationResolverPort,
  StoredObjectStorageRuntimeAdapter,
  type StoredObjectStorageDriver,
} from "@langwatch/stored-object-server";
import { COMMAND_INLINE_THRESHOLD, type RecordSpanCommandData } from "@langwatch/trace-contract";
import { SPOOL_REF_V2 } from "@langwatch/trace-server";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import { composeApiTraceSpool } from "../api-trace-spool.composition.ts";

const PROJECT_ID = "project-001";

describe("given a process that composed an object store", () => {
  describe("when the offload switch is on and a span is over the inline threshold", () => {
    it("writes the whole payload to the spool and queues only its reference", async () => {
      const world = spoolWorld({ enabled: true });

      const prepared = await world.prepare(commandCarrying(300 * 1024));

      expect(prepared.spoolRef).toBe(SPOOL_REF_V2);
      expect(prepared.span.attributes).toEqual([]);
      expect(Buffer.byteLength(JSON.stringify(prepared), "utf8")).toBeLessThan(
        COMMAND_INLINE_THRESHOLD,
      );
      expect([...world.objects.keys()]).toEqual([
        `s3://spool-bucket/trace-blobs/spool/${PROJECT_ID}/${TRACE_ID}/${SPAN_ID}`,
      ]);
    });
  });

  describe("when the offload switch is off for the project", () => {
    it("queues the span whole and writes no spool object", async () => {
      const world = spoolWorld({ enabled: false });

      const prepared = await world.prepare(commandCarrying(300 * 1024));

      expect(prepared.spoolRef).toBeUndefined();
      expect(world.objects.size).toBe(0);
      expect(world.flagTargets).toEqual([
        { flagKey: "release_trace_blob_offload", projectId: PROJECT_ID },
      ]);
    });
  });

  describe("when the switch cannot be read", () => {
    it("falls open to the inline route and says the protection was skipped", async () => {
      const world = spoolWorld({ enabled: new Error("the flag store is unreachable") });

      const prepared = await world.prepare(commandCarrying(300 * 1024));

      expect(prepared.spoolRef).toBeUndefined();
      expect(world.objects.size).toBe(0);
      expect(world.warn).toHaveBeenCalledOnce();
      expect(world.warn.mock.calls[0]?.[1]).toContain("oversize protection skipped");
    });
  });

  describe("when a span is within the inline threshold", () => {
    it("writes no spool object even with the switch on", async () => {
      const world = spoolWorld({ enabled: true });

      const prepared = await world.prepare(commandCarrying(10 * 1024));

      expect(prepared.spoolRef).toBeUndefined();
      expect(world.objects.size).toBe(0);
    });
  });
});

describe("given a process that composed no object store", () => {
  describe("when the spool is composed", () => {
    it("composes nothing and names what an oversized span loses", () => {
      const warn = vi.fn();

      const composed = composeApiTraceSpool({
        storage: undefined,
        azureRetentionConfirmed: false,
        featureFlags: new TestFeatureFlags(true, []),
        logger: { warn } as never,
      });

      expect(composed).toBeUndefined();
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0]?.[1]).toContain("truncated");
    });
  });
});

// ---------------------------------------------------------------------------

const TRACE_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaabb";
const SPAN_ID = "bbbbbbbbbbbbbbbb";

function commandCarrying(outputBytes: number): RecordSpanCommandData {
  return {
    tenantId: PROJECT_ID,
    occurredAt: 1700000000000,
    span: {
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      name: "test-span",
      kind: 1,
      startTimeUnixNano: { low: 0, high: 0 },
      endTimeUnixNano: { low: 1000000, high: 0 },
      attributes: [{ key: "langwatch.output", value: { stringValue: "z".repeat(outputBytes) } }],
      events: [],
      links: [],
      status: {},
      droppedAttributesCount: 0,
      droppedEventsCount: 0,
      droppedLinksCount: 0,
    },
    resource: null,
    instrumentationScope: null,
  } as unknown as RecordSpanCommandData;
}

function spoolWorld(input: { enabled: boolean | Error }) {
  const objects = new Map<string, Buffer>();
  const flagTargets: { flagKey: string; projectId: string }[] = [];
  const warn = vi.fn();

  const composed = composeApiTraceSpool({
    storage: {
      runtime: StoredObjectStorageRuntimeAdapter.create({
        destination: new TestDestinations(),
        s3ForProject: () => new InMemoryDriver(objects),
        fileForProject: () => new InMemoryDriver(objects),
      }),
      aws: AwsClientProcessRuntime.create({ outboundProxy: new NoOutboundProxy() }),
    },
    azureRetentionConfirmed: false,
    featureFlags: new TestFeatureFlags(input.enabled, flagTargets),
    logger: { warn } as never,
  });
  if (!composed) throw new Error("This world composed an object store, so it composes a spool.");

  return {
    objects,
    flagTargets,
    warn,
    prepare: (data: RecordSpanCommandData) => composed.prepare(data),
  };
}

class NoOutboundProxy extends OutboundProxyResolverPort {
  tryResolveForHost(): string | undefined {
    return undefined;
  }
}

class TestDestinations extends StoredObjectProjectDestinationResolverPort {
  resolve(): Promise<StoredObjectStorageDestination> {
    return Promise.resolve({ kind: "s3", bucket: "spool-bucket" });
  }
}

class InMemoryDriver implements StoredObjectStorageDriver {
  constructor(private readonly objects: Map<string, Buffer>) {}

  put(uri: string, bytes: Buffer): Promise<void> {
    this.objects.set(uri, bytes);
    return Promise.resolve();
  }

  get(uri: string): Promise<Readable> {
    const bytes = this.objects.get(uri);
    if (!bytes) return Promise.reject(new Error(`no object at ${uri}`));
    return Promise.resolve(Readable.from([bytes]));
  }

  delete(uri: string): Promise<void> {
    this.objects.delete(uri);
    return Promise.resolve();
  }

  exists(uri: string): Promise<boolean> {
    return Promise.resolve(this.objects.has(uri));
  }
}

/** The per-project switch, answering what the case says and recording who asked. */
class TestFeatureFlags extends FeatureFlagService {
  constructor(
    private readonly answer: boolean | Error,
    private readonly asked: { flagKey: string; projectId: string }[],
  ) {
    super();
  }

  isEnabled(flagKey: FeatureFlagKey, target: FeatureFlagTarget): Promise<boolean> {
    this.asked.push({
      flagKey,
      projectId: "projectId" in target ? target.projectId : "",
    });
    return this.answer instanceof Error
      ? Promise.reject(this.answer)
      : Promise.resolve(this.answer);
  }

  private unread(): Promise<never> {
    return Promise.reject(new Error("This world reads one flag."));
  }

  resolveFrontendFlags(): Promise<never> {
    return this.unread();
  }

  resolvePublicAnonymousFlags(): Promise<never> {
    return this.unread();
  }

  resolveExperimentCatalogue(): Promise<never> {
    return this.unread();
  }

  setUserExperimentEnrolment(): Promise<never> {
    return this.unread();
  }

  setExperimentTenantPolicy(): Promise<never> {
    return this.unread();
  }

  listOperatorCatalogue(): Promise<never> {
    return this.unread();
  }

  setEnabled(): Promise<never> {
    return this.unread();
  }

  setRules(): Promise<never> {
    return this.unread();
  }

  clearStoredFlag(): Promise<never> {
    return this.unread();
  }
}
