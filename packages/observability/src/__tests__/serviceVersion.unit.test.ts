/**
 * Whether a log line can say which build produced it.
 *
 * The deployment already states the version — OTEL_RESOURCE_ATTRIBUTES carries
 * `service.version=<tag>` and `envDetector` merges it into the OTel resource —
 * but that resource only reaches telemetry we EXPORT. These logs go to stdout
 * and are read back off the pod's log file, a path the resource never touches.
 * Measured against prod on 2026-08-07, `service_version` appeared on no record
 * in the entire fleet, so no log line could be tied to a build.
 *
 * The existing env var is parsed rather than a second one introduced, because
 * two ways to state the version is how they drift apart.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { serviceVersionField } from "../logger";

const ORIGINAL = { ...process.env };

describe("serviceVersionField", () => {
  beforeEach(() => {
    delete process.env.SERVICE_VERSION;
    delete process.env.OTEL_RESOURCE_ATTRIBUTES;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  describe("given the deployment's OTEL_RESOURCE_ATTRIBUTES", () => {
    it("reads the version out of it", () => {
      process.env.OTEL_RESOURCE_ATTRIBUTES =
        "service.name=langwatch,service.version=git-5373dad,deployment.environment.name=production";

      expect(serviceVersionField()).toEqual({
        "service.version": "git-5373dad",
      });
    });

    it("is not fooled by another key ending in the same word", () => {
      process.env.OTEL_RESOURCE_ATTRIBUTES = "app.version=1.2.3,service.version=git-abc";

      expect(serviceVersionField()).toEqual({ "service.version": "git-abc" });
    });

    it("tolerates whitespace around the pair", () => {
      process.env.OTEL_RESOURCE_ATTRIBUTES =
        "service.name=langwatch, service.version = git-spaced ";

      expect(serviceVersionField()).toEqual({
        "service.version": "git-spaced",
      });
    });

    it("keeps a value containing an equals sign intact", () => {
      process.env.OTEL_RESOURCE_ATTRIBUTES = "service.version=a=b";

      expect(serviceVersionField()).toEqual({ "service.version": "a=b" });
    });

    /**
     * The spec's format percent-encodes `,` and `=` in values, which is how a
     * value containing either survives a format that separates on both. The
     * OTel SDK's envDetector decodes them, so this must too — a log saying
     * `git%2Dabc` where the trace says `git-abc` is precisely the drift this
     * function exists to prevent.
     */
    it("percent-decodes the value, as the OTel SDK does", () => {
      process.env.OTEL_RESOURCE_ATTRIBUTES = "service.version=git%2Dabc%2C1";

      expect(serviceVersionField()).toEqual({ "service.version": "git-abc,1" });
    });

    it("falls back to the raw text on a malformed escape", () => {
      process.env.OTEL_RESOURCE_ATTRIBUTES = "service.version=100%off";

      expect(serviceVersionField()).toEqual({ "service.version": "100%off" });
    });

    it("ignores the key when it has no value", () => {
      process.env.OTEL_RESOURCE_ATTRIBUTES = "service.version=";

      expect(serviceVersionField()).toEqual({});
    });

    it("ignores a malformed entry with no separator", () => {
      process.env.OTEL_RESOURCE_ATTRIBUTES = "justakey,service.version=ok";

      expect(serviceVersionField()).toEqual({ "service.version": "ok" });
    });
  });

  describe("given SERVICE_VERSION is set explicitly", () => {
    it("wins over the resource attributes", () => {
      process.env.SERVICE_VERSION = "explicit";
      process.env.OTEL_RESOURCE_ATTRIBUTES = "service.version=from-attrs";

      expect(serviceVersionField()).toEqual({ "service.version": "explicit" });
    });
  });

  describe("given neither is set", () => {
    it("adds no field at all, rather than an empty one", () => {
      expect(serviceVersionField()).toEqual({});
    });

    it("adds nothing when the attributes name other keys only", () => {
      process.env.OTEL_RESOURCE_ATTRIBUTES = "service.name=langwatch";

      expect(serviceVersionField()).toEqual({});
    });
  });
});
