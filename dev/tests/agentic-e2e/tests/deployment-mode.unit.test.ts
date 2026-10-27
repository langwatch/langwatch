import { expect, test } from "@playwright/test";

import { requireDeploymentMode } from "./deployment-mode";

/** @scenario The e2e guard refuses a journey whose required mode differs from the effective one */
test("refuses a journey whose required mode differs from the effective one", () => {
  const before = process.env.LANGWATCH_DEPLOYMENT_MODE;
  try {
    process.env.LANGWATCH_DEPLOYMENT_MODE = "sh-free";
    expect(() => requireDeploymentMode({ mode: "saas" })).toThrow(/saas.*sh-free/);
    expect(() => requireDeploymentMode({ mode: "sh-free" })).not.toThrow();
  } finally {
    if (before === undefined) delete process.env.LANGWATCH_DEPLOYMENT_MODE;
    else process.env.LANGWATCH_DEPLOYMENT_MODE = before;
  }
});
