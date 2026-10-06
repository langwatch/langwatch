import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, "../../..");
const DOCKERFILE = readFileSync(path.join(REPO_ROOT, "infra/docker/Dockerfile"), "utf-8");
const readPackageScripts = (app: string): Record<string, string> =>
  JSON.parse(readFileSync(path.join(REPO_ROOT, "apps", app, "package.json"), "utf-8")).scripts;

describe("given the production image", () => {
  /** @scenario "API and worker remain commands in the same image" */
  it("carries the UI, API and worker applications and starts the API by default", () => {
    for (const app of ["ui", "api", "worker"]) {
      expect(DOCKERFILE, app).toContain(`COPY --from=builder /app/apps/${app} ./apps/${app}`);
    }
    expect(DOCKERFILE).toMatch(/^CMD cd \/app\/apps\/api && pnpm --silent run start$/m);
  });

  /** @scenario "API and worker remain commands in the same image" */
  it("starts the worker from its own start script inside that one image", () => {
    expect(readPackageScripts("worker").start).toContain("src/main.ts");
    expect(readPackageScripts("api").start).toContain("src/main.ts");
    expect(DOCKERFILE.match(/^FROM (?![^\n]* AS )/gm) ?? []).toHaveLength(1);
  });
});
