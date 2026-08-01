/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  broadcastModelProvidersUpdated,
  invalidateModelProviderQueries,
  subscribeToModelProvidersUpdated,
} from "../modelProviderSync";

/**
 * jsdom doesn't implement real cross-instance BroadcastChannel delivery, so
 * exercising the actual browser API here would test jsdom's fidelity, not
 * our wiring. This fake reproduces just the piece our module depends on
 * (same-name instances see each other's postMessage, synchronously — real
 * BroadcastChannel is async, but that distinction doesn't matter for
 * asserting delivery/no-delivery contracts).
 */
class FakeBroadcastChannel {
  static channels = new Map<string, Set<FakeBroadcastChannel>>();
  onmessage: ((event: { data: unknown }) => void) | null = null;
  constructor(public name: string) {
    const peers = FakeBroadcastChannel.channels.get(name) ?? new Set();
    peers.add(this);
    FakeBroadcastChannel.channels.set(name, peers);
  }
  postMessage(data: unknown) {
    for (const peer of FakeBroadcastChannel.channels.get(this.name) ?? []) {
      if (peer !== this) peer.onmessage?.({ data });
    }
  }
  close() {
    FakeBroadcastChannel.channels.get(this.name)?.delete(this);
  }
}

describe("modelProviderSync", () => {
  beforeEach(() => {
    FakeBroadcastChannel.channels.clear();
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("given a tab opened NoModelsConfiguredCallout's settings link", () => {
    it("delivers a broadcast from one BroadcastChannel handle to another", () => {
      const onUpdate = vi.fn();
      const unsubscribe = subscribeToModelProvidersUpdated(onUpdate);

      broadcastModelProvidersUpdated();

      expect(onUpdate).toHaveBeenCalledTimes(1);
      unsubscribe();
    });

    it("stops delivering messages after unsubscribe", () => {
      const onUpdate = vi.fn();
      const unsubscribe = subscribeToModelProvidersUpdated(onUpdate);
      unsubscribe();

      broadcastModelProvidersUpdated();

      expect(onUpdate).not.toHaveBeenCalled();
    });
  });

  describe("when BroadcastChannel is unavailable", () => {
    it("no-ops instead of throwing", () => {
      vi.stubGlobal("BroadcastChannel", undefined);

      expect(() => broadcastModelProvidersUpdated()).not.toThrow();
      const unsubscribe = subscribeToModelProvidersUpdated(vi.fn());
      expect(() => unsubscribe()).not.toThrow();
    });
  });

  describe("invalidateModelProviderQueries", () => {
    it("invalidates every query surface that reads stored provider/default-model state", async () => {
      const invalidate = vi.fn().mockResolvedValue(undefined);
      const utils = {
        modelProvider: {
          getAllForProject: { invalidate },
          getAllForProjectForFrontend: { invalidate },
          listAllForProjectForFrontend: { invalidate },
          listAllForOrganizationForFrontend: { invalidate },
          getResolvedDefault: { invalidate },
          getDefaultModelsForProject: { invalidate },
        },
      } as any;

      await invalidateModelProviderQueries(utils);

      expect(invalidate).toHaveBeenCalledTimes(6);
    });
  });
});
