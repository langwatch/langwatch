/**
 * What a worker process installs, how often, and what it closes when an install fails.
 * Spec: specs/server/composition-spec.feature
 */
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/application.ts";
import { serverFeature } from "../src/feature-installer.ts";
import { memberSourceOf } from "./member-source.ts";

describe("given a worker process with one feature installer", () => {
  describe("when two starts race against each other", () => {
    /** @scenario "The worker installs each feature consumer exactly once" */
    it("installs once and hands both callers the one started process", async () => {
      const setup = vi.fn(() => ({}));
      const consumers = vi.fn(() => ({ consumers: ["index-traces"] }));
      const started = vi.fn();
      const feature = serverFeature<object>("indexing")
        .withSetup(setup)
        .withWorker(consumers)
        .build();
      const runtime = await createApp({ role: "worker", members: memberSourceOf({}) })
        .withService({ name: "consumers", start: started, stop: () => undefined })
        .withModules([feature])
        .boot();

      const first = runtime.start();
      const second = runtime.start();
      await Promise.all([first, second]);

      expect(second).toBe(first);
      expect(setup).toHaveBeenCalledOnce();
      expect(started).toHaveBeenCalledOnce();
      expect(runtime.module(feature).worker()).toEqual({ consumers: ["index-traces"] });
      expect(runtime.module(feature).worker()).toBe(runtime.module(feature).worker());
      expect(consumers).toHaveBeenCalledOnce();
      await runtime.stop();
    });
  });
});

describe("given a worker process with two feature installers", () => {
  describe("when the second installer fails", () => {
    /** @scenario "A failed installation closes what was already installed" */
    it("refuses to start and closes the feature installed first", async () => {
      const closed: string[] = [];
      const first = serverFeature<object>("first")
        .withSetup(() => ({}))
        .withClose(() => {
          closed.push("first");
        })
        .build();
      const second = serverFeature<object>("second")
        .withSetup(() => {
          throw new Error("second failed to install");
        })
        .withClose(() => {
          closed.push("second");
        })
        .build();

      const booting = createApp({ role: "worker", members: memberSourceOf({}) })
        .withModules([first, second])
        .boot();

      await expect(booting).rejects.toThrow("second failed to install");
      expect(closed).toEqual(["first"]);
    });
  });
});
