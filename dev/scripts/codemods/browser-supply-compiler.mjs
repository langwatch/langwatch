#!/usr/bin/env node
import { spawnSync } from "node:child_process";
// A compiler experiment over today's page, drawer and package identities. Never boots the UI.
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { inventory, read, root } from "./browser-supply-tree.mjs";

const tree = inventory();
const directory = mkdtempSync(join(tmpdir(), "browser-supply-compiler-"));
const declarations = (native) => {
  const selected = tree.pages.filter((page) => native || page.file.endsWith("ui-route-table.ts"));
  return [
    ...tree.modules.filter((module) => module.manifest).map((module) => module.id),
    "$shell",
  ].map((id) => ({
    id,
    pages: selected
      .filter((page) => (page.owner === "shell" ? "$shell" : page.owner) === id)
      .map((page) => page.page),
    paths: tree.routes
      .filter(
        (page) =>
          (native || page.file.endsWith("ui-route-table.ts")) &&
          page.path &&
          selected.find((entry) => entry.page === page.page)?.owner ===
            (id === "$shell" ? "shell" : id),
      )
      .map((page) => page.path),
    drawers: tree.drawers.filter((drawer) => drawer.owner === id).map((drawer) => drawer.name),
    publishes:
      id === "organization"
        ? ["@langwatch/organization-browser/surfaces/personal-workspace-features"]
        : [],
    mounts: ["annotation", "user"].includes(id)
      ? ["@langwatch/organization-browser/surfaces/personal-workspace-features"]
      : [],
  }));
};
const base = declarations(false);
const packages = Object.fromEntries([
  ...tree.modules
    .filter((module) => module.manifest)
    .map((module) => [module.id, module.manifest.name]),
  ["$shell", "@langwatch/ui"],
]);
const count = (data, key) => data.reduce((total, item) => total + item[key].length, 0);
/** @type {Array<[string, unknown, unknown]>} */
const cases = [
  ["valid-real-scale", base, null],
  ["valid-including-native-routes", declarations(true), null],
  [
    "duplicate-path",
    base.map((entry) =>
      entry.id === "user" ? { ...entry, paths: [...entry.paths, "/settings"] } : entry,
    ),
    'duplicate route path "/settings"',
  ],
  [
    "duplicate-drawer",
    base.map((entry) =>
      entry.id === "user" ? { ...entry, drawers: [...entry.drawers, "createProject"] } : entry,
    ),
    'duplicate drawer name "createProject"',
  ],
  [
    "duplicate-id",
    [...base, { id: "project", pages: [], paths: [], drawers: [], publishes: [], mounts: [] }],
    'duplicate module id "project"',
  ],
  [
    "duplicate-publication",
    base.map((entry) =>
      entry.id === "organization"
        ? { ...entry, publishes: [...entry.publishes, ...entry.publishes] }
        : entry,
    ),
    'duplicate surface publication "@langwatch/organization-browser/surfaces/personal-workspace-features"',
  ],
  [
    "foreign-publisher",
    base.map((entry) =>
      entry.id === "user" ? { ...entry, publishes: ["@langwatch/project-browser/pretend"] } : entry,
    ),
    'module "user" cannot publish "@langwatch/project-browser/pretend"',
  ],
  [
    "unpublished-mount",
    base.map((entry) =>
      entry.id === "user"
        ? { ...entry, mounts: ["@langwatch/organization-browser/not-published"] }
        : entry,
    ),
    'unpublished surface "@langwatch/organization-browser/not-published"',
  ],
];
try {
  writeFileSync(
    join(directory, "browser-supply.types.ts"),
    read("dev/scripts/codemods/browser-supply.types.ts"),
  );
  console.log(
    `real tree: ${base.length - 1} module ids + shell; ${count(base, "pages")} page keys; ${count(base, "drawers")} drawers; ${count(base, "paths")} paths`,
  );
  for (const [label, data, expected] of cases) {
    writeFileSync(
      join(directory, `${label}.ts`),
      `import { withModules } from "./browser-supply.types";\nconst modules = ${JSON.stringify(data)} as const;\nconst packages = ${JSON.stringify(packages)} as const;\nwithModules(packages, modules).render();\n`,
    );
    writeFileSync(
      join(directory, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          types: [],
          skipLibCheck: true,
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "bundler",
        },
        files: [`${label}.ts`],
      }),
    );
    const start = performance.now();
    const run = spawnSync(
      process.execPath,
      [
        resolve(root, "node_modules/typescript/bin/tsc"),
        "--project",
        "tsconfig.json",
        "--pretty",
        "false",
      ],
      { cwd: directory, encoding: "utf8", timeout: 60000 },
    );
    if (run.error) throw run.error;
    const diagnostic = `${run.stdout}${run.stderr}`.trim();
    const validExit = expected ? [1, 2].includes(run.status) : run.status === 0;
    const namedError = expected ? diagnostic.includes(JSON.stringify(expected).slice(1, -1)) : true;
    const codeMatches = expected ? diagnostic.includes("TS2349") : true;
    if (!validExit || !namedError || !codeMatches) {
      throw new Error(`${label} unexpected compiler result (${run.status}):\n${diagnostic}`);
    }
    console.log(`${label}: exit ${run.status}; ${Math.round(performance.now() - start)} ms`);
    if (diagnostic) console.log(diagnostic);
  }
  console.log(
    "PASS: 2 positive compilations; 6 named compile-time refusals; no application executed",
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
