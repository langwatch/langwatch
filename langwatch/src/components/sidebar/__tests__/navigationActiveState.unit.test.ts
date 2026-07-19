import { describe, expect, it } from "vitest";

import {
  isExperimentsActivePath,
  isOnlineEvaluationsActivePath,
} from "../navigationActiveState";

describe("navigation active state during the evaluation route migration", () => {
  /** @scenario Preserve existing project access during the navigation migration */
  it("keeps experiment and wizard routes active under Experiments", () => {
    expect(isExperimentsActivePath("/[project]/experiments")).toBe(true);
    expect(isExperimentsActivePath("/[project]/evaluations")).toBe(true);
    expect(
      isExperimentsActivePath("/[project]/evaluations/wizard/experiment-1"),
    ).toBe(true);
  });

  /** @scenario Preserve existing project access during the navigation migration */
  it("keeps live evaluation routes active under Online Evaluations", () => {
    expect(
      isOnlineEvaluationsActivePath("/[project]/online-evaluations"),
    ).toBe(true);
    expect(
      isOnlineEvaluationsActivePath("/[project]/evaluations/new"),
    ).toBe(true);
    expect(
      isOnlineEvaluationsActivePath("/[project]/evaluations/edit/monitor-1"),
    ).toBe(true);
    expect(
      isOnlineEvaluationsActivePath("/[project]/evaluations/wizard/experiment-1"),
    ).toBe(false);
  });
});
