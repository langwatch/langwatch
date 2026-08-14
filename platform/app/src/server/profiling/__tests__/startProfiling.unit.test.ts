import { afterEach, describe, expect, it, vi } from "vitest";

import {
  normaliseTagKey,
  startProfiling,
  tagsFromResourceAttributes,
} from "../startProfiling";

describe("given a process deciding whether to profile itself", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("when no profiling server address is configured", () => {
    // The cost argument for the whole gate rests on this: no address means the
    // native profiler bindings are never required, so a self-hosted install
    // that has never heard of Pyroscope pays nothing at boot.
    // @scenario "A process with no profiling endpoint does not profile"
    it("starts nothing", () => {
      expect(
        startProfiling({
          serverAddress: undefined,
          appName: "langwatch-app",
          environment: "development",
          resourceAttributes: undefined,
        }),
      ).toBeUndefined();
    });

    // @scenario "A process with no profiling endpoint does not profile"
    it("treats a blank address as no address", () => {
      expect(
        startProfiling({
          serverAddress: "   ",
          appName: "langwatch-app",
          environment: "development",
          resourceAttributes: undefined,
        }),
      ).toBeUndefined();
    });
  });

  describe("when the profiler cannot start", () => {
    // A process that cannot profile itself has one fewer debugging signal. A
    // process that refuses to boot because it could not profile itself is an
    // outage, so the failure is a warning and the server serves traffic.
    // @scenario "A profiler that cannot start does not stop the process"
    it("warns and returns without throwing", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.doMock("@pyroscope/nodejs", () => {
        throw new Error("native binding unavailable for this platform");
      });

      expect(() =>
        startProfiling({
          // A port nothing listens on is still a valid address: the failure
          // being simulated is the module load, not the upload.
          serverAddress: "http://127.0.0.1:1",
          appName: "langwatch-app",
          environment: "development",
          resourceAttributes: undefined,
        }),
      ).not.toThrow();

      expect(warn).toHaveBeenCalled();
    });
  });
});

describe("given telemetry identity carried on OTEL_RESOURCE_ATTRIBUTES", () => {
  describe("when the attributes use OpenTelemetry's dotted names", () => {
    // Pyroscope label names follow the Prometheus grammar and reject a dot.
    // A verbatim copy does not error — the push succeeds and the label is
    // simply gone — which is the worst of both worlds.
    // @scenario "Profiles carry the worktree label in local development"
    it("rewrites them to names Pyroscope accepts", () => {
      const tags = tagsFromResourceAttributes(
        "langwatch.worktree=portless,deployment.environment.name=development",
      );

      expect(tags).toEqual({
        langwatch_worktree: "portless",
        deployment_environment_name: "development",
      });
    });

    // @scenario "Profiles carry the worktree label in local development"
    it("keeps the spelling Loki uses for the same attribute", () => {
      expect(normaliseTagKey("langwatch.worktree")).toBe("langwatch_worktree");
    });

    // A leading digit is as invalid a label name as a dot is.
    // @scenario "Profiles carry the worktree label in local development"
    it("rewrites a leading digit rather than dropping it", () => {
      expect(normaliseTagKey("9lives")).toBe("_lives");
    });
  });

  describe("when the attributes are malformed", () => {
    // @scenario "Profiles carry the worktree label in local development"
    it("yields no tags rather than throwing", () => {
      for (const input of [undefined, "", "   ", "novalue", "=orphan", ",,,"]) {
        expect(tagsFromResourceAttributes(input)).toEqual({});
      }
    });

    // @scenario "Profiles carry the worktree label in local development"
    it("keeps the well-formed pairs alongside the junk", () => {
      expect(
        tagsFromResourceAttributes(
          "novalue,langwatch.worktree=portless,=orphan",
        ),
      ).toEqual({ langwatch_worktree: "portless" });
    });

    // A value containing '=' is legal and must survive intact — a URL or a
    // base64 fragment in a resource attribute is not unusual.
    // @scenario "Profiles carry the worktree label in local development"
    it("splits on the first separator only", () => {
      expect(tagsFromResourceAttributes("service.name=a=b")).toEqual({
        service_name: "a=b",
      });
    });
  });
});
