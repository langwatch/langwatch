/**
 * @see specs/upgrade/stepping.feature
 */
import { describe, expect, it } from "vitest";

import { clickHouseRunOptions } from "../upgrade.ts";

describe("clickHouseRunOptions()", () => {
  const settings = { clusterName: undefined, childEnvironment: {}, waitSeconds: 5 };

  /** @scenario "A stepped release migrates ClickHouse up to its own last goose version" */
  it("carries the release's goose version when stepping and none in one pass", () => {
    const url = "http://clickhouse:8123/langwatch";
    expect(clickHouseRunOptions({ url, settings, upTo: 2, signal: undefined }).upTo).toBe(2);
    expect(clickHouseRunOptions({ url, settings, upTo: undefined, signal: undefined })).toEqual({
      connectionUrl: url,
      clusterName: undefined,
      childEnvironment: {},
      waitSeconds: 5,
      verbose: true,
    });
    expect(
      "upTo" in clickHouseRunOptions({ url, settings, upTo: undefined, signal: undefined }),
    ).toBe(false);
  });
});
