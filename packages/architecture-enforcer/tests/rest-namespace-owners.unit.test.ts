/** Spec: packages/architecture-enforcer/specs/rest-namespace-owners.feature. Record: ARCHITECTURE.md §8. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  declaredRestRoutes,
  lintRestNamespaceOwners,
} from "../src/policies/boundaries/rest-namespace-owners.ts";
import type { FeatureCatalogueEntry } from "../src/types.ts";
import { buildWorkspaceSnapshot } from "../src/workspace/snapshot.ts";
import { snapshotOf } from "./workspace.ts";

const OWNED: Record<string, string[] | undefined> = {
  billing: undefined,
  dashboard: ["dashboards"],
  dataset: ["dataset"],
  project: ["projects"],
  webhook: undefined,
};
const CATALOGUE: FeatureCatalogueEntry[] = Object.keys(OWNED).map((id) => ({
  id,
  root: `modules/${id}`,
  classification: "core",
  subjects: [id],
}));
const CHART = "/api/v1/projects/:projectId/analytics/charts";
let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rest-namespace-owners-"));
  write(
    "modules/catalogue.json",
    JSON.stringify({
      version: 0,
      features: CATALOGUE.map((entry) => ({
        ...entry,
        ...(OWNED[entry.id] ? { restNamespaces: OWNED[entry.id] } : {}),
      })),
    }),
  );
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(path: string, content: string): void {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

function literalFamily({ module, route }: { module: string; route: string }): void {
  write(
    `modules/${module}/process/src/transport/${module}-doors.rest.ts`,
    `export const doors = defineRestRouter(Api)\n` +
      `  .withNamespace("${module}-doors")\n` +
      `  .withAddressing("literal", { v1Twin: false })\n` +
      `${route}\n` +
      `  .build();\n`,
  );
}

function run() {
  return lintRestNamespaceOwners(snapshotOf({ root, catalogue: CATALOGUE }));
}

describe("rest-namespace-owners", () => {
  /** @scenario "A route under another module's owned namespace without a shared path is a finding" */
  it("reports a literal route under project's namespace, telling the author what to declare", () => {
    literalFamily({ module: "dashboard", route: `  .get("${CHART}", "listCharts")` });

    const violations = run();

    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(4);
    expect(violations[0]?.message).toContain('"projects", which project owns');
    expect(violations[0]?.allowed).toContain(
      '.withSharedPath({ owner: "project", reason, deprecate })',
    );
  });

  /** @scenario "A route under another module's owned namespace without a shared path is a finding" */
  it("reports a prefixed family claiming another module's namespace", () => {
    write(
      "modules/dashboard/process/src/transport/dashboard-projects.rest.ts",
      `export const doors = defineRestRouter(Api)\n  .withNamespace("projects")\n  .get("/charts", "listCharts")\n  .build();\n`,
    );

    expect(run().map((violation) => violation.message)).toEqual([
      'GET /charts of dashboard sits in the REST namespace "projects", which project owns (modules/catalogue.json).',
    ]);
  });

  /** @scenario "A route declaring a shared path with the namespace owner passes" */
  it("passes a route declaring a shared path owned by project, inline or through a constant", () => {
    write(
      "modules/dashboard/process/src/transport/dashboard-doors.rest.ts",
      `const PROJECT = { owner: "project", reason: "nested", permanent: true } as const;\n` +
        `export const doors = defineRestRouter(Api)\n` +
        `  .withNamespace("dashboard-doors")\n` +
        `  .withAddressing("literal")\n` +
        `  .get("${CHART}", "listCharts")\n` +
        `  .withSharedPath(PROJECT)\n` +
        "  .post(`/api/dataset/${'evaluate'}/run`, \"evaluate\")\n" +
        `  .withSharedPath({ owner: "dataset", reason: "r", deprecate: "d" })\n` +
        `  .build();\n`,
    );

    expect(run()).toEqual([]);
  });

  /** @scenario "A shared path naming the wrong owner is a finding" */
  it("reports a shared path naming a module that does not own the namespace", () => {
    literalFamily({
      module: "dashboard",
      route: `  .get("${CHART}", "listCharts")\n  .withSharedPath({ owner: "dataset", reason: "r", deprecate: "d" })`,
    });

    const [violation] = run();

    expect(violation?.message).toContain("declares a shared path with dataset, but project owns");
    expect(violation?.allowed).toContain('owner: "project"');
  });

  /** @scenario "A shared path naming the wrong owner is a finding" */
  it("reports a shared path in a namespace nobody owns", () => {
    literalFamily({
      module: "billing",
      route: `  .post("/api/webhooks/stripe", "stripe")\n  .withSharedPath({ owner: "webhook", reason: "r", deprecate: "d" })`,
    });

    const [violation] = run();

    expect(violation?.message).toContain('no module owns the REST namespace "webhooks"');
    expect(violation?.allowed).toContain("Drop .withSharedPath");
  });

  /** @scenario "A route under an unowned category prefix passes" */
  it("passes two modules serving under an unowned category prefix", () => {
    literalFamily({ module: "billing", route: `  .post("/api/webhooks/stripe", "stripe")` });
    literalFamily({ module: "webhook", route: `  .post("/api/webhooks/inbound", "inbound")` });

    expect(run()).toEqual([]);
  });

  /** @scenario "The repository's REST routes are held to the owner map" */
  it("reports nothing on the repository, whose four overlaps declare their owners", () => {
    const repository = join(import.meta.dirname, "../../..");
    const transport = (path: string) =>
      declaredRestRoutes(join(repository, path)).map((route) => ({
        namespace: route.namespace,
        owner: route.sharedOwner,
      }));

    expect(
      lintRestNamespaceOwners(buildWorkspaceSnapshot({ root: repository, changedFiles: [] })),
    ).toEqual([]);
    expect(
      transport("modules/dashboard/process/src/transport/saved-workbench-chart.rest.ts"),
    ).toContainEqual({
      namespace: "projects",
      owner: "project",
    });
    expect(
      transport("modules/evaluation/process/src/transport/evaluations-legacy.rest.ts"),
    ).toEqual(
      expect.arrayContaining([
        { namespace: "evaluations", owner: "experiment" },
        { namespace: "dataset", owner: "dataset" },
      ]),
    );
    expect(transport("modules/webhook/process/src/transport/webhook-spend-replay.rest.ts")).toEqual(
      [{ namespace: "gateway", owner: "gateway" }],
    );
  });
});
