/**
 * Which installs judge with LangWatch's own key.
 * @see specs/self-hosting/connected-services/connect-settings.feature
 */
import { describe, expect, it } from "vitest";

import { isLangWatchJudgeHost } from "../instant-eval-judge-host.ts";

describe("isLangWatchJudgeHost", () => {
  it("holds on LangWatch Cloud whatever its environment", () => {
    expect(isLangWatchJudgeHost({ isSaas: true, nodeEnvironment: "production" })).toBe(true);
  });

  it("holds on a development checkout", () => {
    expect(isLangWatchJudgeHost({ isSaas: false, nodeEnvironment: "development" })).toBe(true);
  });

  it("does not hold on a self-hosted production install", () => {
    expect(isLangWatchJudgeHost({ isSaas: false, nodeEnvironment: "production" })).toBe(false);
    expect(isLangWatchJudgeHost({ isSaas: false, nodeEnvironment: undefined })).toBe(false);
  });
});
