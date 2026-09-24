import type { WorkbenchStateView } from "@langwatch/experiment-contract";
import { describe, expect, it } from "vitest";

import { workbenchStateAnswer } from "../experiment-workbench-state-answer.rules.ts";

const workbench: WorkbenchStateView = {
  experimentId: "experiment_1",
  slug: "my-experiment",
  name: "My experiment",
  state: null,
  version: 3,
  updatedAt: new Date("2026-09-24T10:00:00.000Z"),
};

const identity = {
  id: "experiment_1",
  slug: "my-experiment",
  version: 3,
  updatedAt: "2026-09-24T10:00:00.000Z",
};

describe("workbenchStateAnswer", () => {
  it("answers the version and timestamp only when fields is version", () => {
    expect(workbenchStateAnswer({ workbench, fields: "version" })).toStrictEqual(identity);
  });

  it("answers the name and the setup beside them otherwise", () => {
    expect(workbenchStateAnswer({ workbench, fields: undefined })).toStrictEqual({
      ...identity,
      name: "My experiment",
      state: null,
    });
  });
});
