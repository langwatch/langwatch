import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const DOCKERFILE = readFileSync(
  path.join(
    import.meta.dirname,
    "..",
    "..",
    "..",
    "..",
    "..",
    "..",
    "infra",
    "docker",
    "Dockerfile",
  ),
  "utf8",
);

describe("infra/docker/Dockerfile scenario child", () => {
  // The worker does not depend on @langwatch/scenario-child, so the worker filter never builds it.
  // Without its own filter the image ships no dist/server bundle and production runs fail.
  it("builds @langwatch/scenario-child", () => {
    expect(DOCKERFILE).toMatch(/--filter "@langwatch\/scenario-child\.\.\."[^\n]*run build/);
  });

  it("installs @langwatch/scenario-child's build dependencies before building it", () => {
    expect(DOCKERFILE).toMatch(
      /pnpm install --frozen-lockfile[^\n]*--filter "@langwatch\/scenario-child\.\.\."/,
    );
  });

  it("installs @langwatch/scenario-child's production dependencies for the bundle's external requires", () => {
    expect(DOCKERFILE).toContain('--filter-prod "@langwatch/scenario-child..."');
  });
});
