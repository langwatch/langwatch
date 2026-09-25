import type { AuthzServerConfig } from "@langwatch/authz-contract";
import { describe, expect, it } from "vitest";

import { createAuthzTestApp } from "./authz.fixture.ts";

describe("AuthzApp.isDemoProject", () => {
  it("answers only for the configured demo project", () => {
    const config: AuthzServerConfig = {
      epochCacheEnabled: true,
      demoProjectId: "project_demo",
      demoProjectUserId: undefined,
      demoProjectSlug: undefined,
    };
    const app = createAuthzTestApp({ config });

    expect(app.isDemoProject({ projectId: "project_demo" })).toBe(true);
    expect(app.isDemoProject({ projectId: "project_other" })).toBe(false);
  });

  it("answers false when the process did not configure a demo project", () => {
    const app = createAuthzTestApp();

    expect(app.isDemoProject({ projectId: "project_demo" })).toBe(false);
  });
});
