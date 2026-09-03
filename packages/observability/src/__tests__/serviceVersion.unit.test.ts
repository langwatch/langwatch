/**
 * Whether a log line can say which build produced it.
 *
 * The configuration root supplies the version from the same OTel resource
 * identity used for traces, but that resource only reaches telemetry we
 * export. These logs go to stdout and are read back off the pod's log file.
 * Measured against prod on 2026-08-07, `service_version` appeared on no record
 * in the entire fleet, so no log line could be tied to a build.
 *
 * One semantic configuration value prevents trace and log identities drifting.
 */

import { describe, expect, it } from "vitest";
import { resolveLoggerConfiguration } from "../logger-config";
import { serviceVersionField } from "../logger";

describe("serviceVersionField", () => {
  it("emits the build identity injected by process configuration", () => {
    const configuration = resolveLoggerConfiguration({ serviceVersion: "git-5373dad" });

    expect(serviceVersionField(configuration)).toEqual({
      "service.version": "git-5373dad",
    });
  });

  it("trims an injected version", () => {
    const configuration = resolveLoggerConfiguration({ serviceVersion: " git-abc " });

    expect(serviceVersionField(configuration)).toEqual({ "service.version": "git-abc" });
  });

  it("adds no field when process configuration supplies no build identity", () => {
    expect(serviceVersionField(resolveLoggerConfiguration())).toEqual({});
  });
});
