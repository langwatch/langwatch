#!/usr/bin/env node
/**
 * Finds value imports from `@langwatch/*` packages that cannot resolve at run
 * time, and proposes what each name most likely became.
 *
 * These fail at ESM **link** time — "does not provide an export named X" —
 * strictly before any module body runs, so they take a process down at boot and
 * nothing later in the graph is ever reached. One is enough to stop apps/api or
 * apps/worker, and because each hides the next, they can only be found one boot
 * at a time unless something enumerates them. That is what this does.
 *
 * Two shapes:
 *   TYPE-ONLY  the name exists, but only as an interface or type alias, so the
 *              package exports no runtime binding. Fix: `import type`, and if a
 *              class `extends` it, `implements` instead (see
 *              find-erased-extends.mjs, which finds the other half of that).
 *   ABSENT     nothing declares the name anywhere. It was renamed or deleted and
 *              the importer was not updated. Most of these are fallout from
 *              f054ab2baf, which stripped a `Port` suffix from 583 symbols and
 *              gave 136 of them a role name instead — so the proposal looks for
 *              the stripped form and for declared names extending it with a role
 *              suffix (Sink, Channel, Resolver, Reader, Scheduler, Client, Store).
 *
 * A proposal with exactly one candidate is usually mechanical. A proposal with
 * none is the expensive kind: the symbol is gone and wants porting from history
 * (`git show b383462d96^:<path>`), which is a judgement call, not a rename.
 *
 *     node dev/scripts/find-unresolvable-imports.mjs [path]
 *     node dev/scripts/find-unresolvable-imports.mjs --self-test
 *
 * Exit 0 clean, 1 found, 2 self-test failed.
 *
 * KNOWN LIMITS, and they matter before you trust a clean answer:
 *  - It reads tracked sources only, so a name exported from a GENERATED file
 *    (`@langwatch/prisma-client/generated`) reads as ABSENT. Those are skipped
 *    explicitly; add any other generated package to GENERATED below.
 *  - It does not resolve a package's export map, so it cannot tell you that a
 *    name is declared but not re-exported by that package's index.
 *  - Test files are excluded: a bad import there fails its own run, loudly, and
 *    is not what stops a process from starting.
 */

import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Packages whose exports are generated, so absent from tracked sources. */
const GENERATED = ["prisma-client"];

/**
 * The `@langwatch/` scope is not the same thing as "in this repository". Several
 * dependencies are published packages pulled from the catalog — `@langwatch/ksuid`,
 * `@langwatch/scenario` — whose exports are in node_modules, not in the tree. An
 * import of one reads as ABSENT to any scan of tracked sources, which is a
 * property of the scan and not of the code. So only packages this workspace
 * actually declares are judged.
 */
const workspacePackages = () => {
  const names = new Set();
  const manifests = execSync(
    "git ls-files '*/package.json' | grep -vE '(^|/)(node_modules|dist)/'",
    { encoding: "utf8", maxBuffer: 1 << 28 },
  )
    .trim()
    .split("\n");
  for (const manifest of manifests) {
    try {
      const name = JSON.parse(readFileSync(manifest, "utf8")).name;
      if (typeof name === "string" && name.startsWith("@langwatch/")) names.add(name);
    } catch {
      /* unparseable manifest */
    }
  }
  return names;
};

/** `@langwatch/trace-process/composition/x` -> `@langwatch/trace-process`. */
const packageOf = (specifier) => specifier.split("/").slice(0, 2).join("/");

/**
 * Each workspace package's own export surface, computed from its entry.
 *
 * Declared-somewhere and exported-by-that-package are different questions, and
 * only the second one decides whether an import links. `CodexAccountService` is
 * a real exported class in its own file, but its package's index re-exports that
 * file through an explicit `export { … }` list that omitted it — so a scan for
 * declarations says "fine" and the process still dies with "does not provide an
 * export named CodexAccountService".
 */
const packageEntries = (sources, manifests) => {
  const entries = new Map();
  for (const [manifest, raw] of manifests) {
    let pkg;
    try {
      pkg = JSON.parse(raw);
    } catch {
      continue;
    }
    if (typeof pkg.name !== "string" || !pkg.name.startsWith("@langwatch/")) continue;
    const dot = pkg.exports?.["."];
    const target = typeof dot === "string" ? dot : (dot?.default ?? dot?.import ?? pkg.main);
    const dir = manifest.replace(/\/package\.json$/, "");
    for (const candidate of [target, "src/index.ts", "index.ts"].filter(Boolean)) {
      const path = `${dir}/${String(candidate).replace(/^\.\//, "")}`;
      if (sources.has(path)) {
        entries.set(pkg.name, path);
        break;
      }
    }
  }
  return entries;
};

const exportListNames = (src) => {
  const names = new Set();
  for (const m of src.matchAll(/export\s+\{([^}]*)\}/g))
    for (const part of m[1].split(",")) {
      const raw = part.trim();
      if (raw)
        names.add(
          raw
            .split(/\s+as\s+/)
            .pop()
            .trim()
            .replace(/^type\s+/, ""),
        );
    }
  return names;
};

// Resolved against the file's own directory and kept REPO-RELATIVE: an
// absolute path never matches the sources map's keys, and the symptom of getting
// that wrong is every surface coming back empty and the whole tree
// reading as broken.
const resolveRelative = (file, specifier) => {
  const parts = file.split("/").slice(0, -1);
  for (const segment of specifier.split("/")) {
    if (segment === "." || segment === "") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return parts.join("/");
};

const reExportedNames = (sources, file, specifier, seen) => {
  const base = resolveRelative(file, specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`])
    if (sources.has(candidate)) return surfaceOf(sources, candidate, seen);
  return new Set();
};

const surfaceOf = (sources, file, seen) => {
  if (seen.has(file)) return new Set();
  seen.add(file);
  const src = sources.get(file);
  if (!src) return new Set();
  const names = new Set();
  for (const m of src.matchAll(
    /^\s*export\s+(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:class|const|let|var|function\s*\*?|enum|interface)\s+([A-Za-z_$][\w$]*)/gm,
  ))
    names.add(m[1]);
  for (const m of src.matchAll(/^\s*export\s+type\s+([A-Za-z_$][\w$]*)\s*[=<]/gm)) names.add(m[1]);
  for (const name of exportListNames(src)) names.add(name);
  for (const m of src.matchAll(/export\s+\*\s+from\s*["'](\.[^"']+)["']/g))
    for (const name of reExportedNames(sources, file, m[1], seen)) names.add(name);
  return names;
};

const exportSurfaces = (sources, manifests) => {
  const surfaces = new Map();
  for (const [name, entry] of packageEntries(sources, manifests))
    surfaces.set(name, surfaceOf(sources, entry, new Set()));
  return surfaces;
};

const collectDeclarations = (sources) => {
  const value = new Set();
  const type = new Set();
  for (const src of sources.values()) addDeclarations(src, { value, type });
  return { value, type };
};

const addDeclarations = (src, { value, type }) => {
  for (const m of src.matchAll(/^\s*export\s+interface\s+([A-Za-z_$][\w$]*)/gm)) type.add(m[1]);
  for (const m of src.matchAll(/^\s*export\s+type\s+([A-Za-z_$][\w$]*)\s*[=<]/gm)) type.add(m[1]);
  // `async`, `default` and a generator star all sit between `export` and the
  // name. Omitting `async` made every `export async function` read as
  // undeclared — four real call sites reported as defects because of one
  // missing keyword in this pattern.
  for (const m of src.matchAll(
    /^\s*export\s+(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:class|const|function\s*\*?|enum)\s+([A-Za-z_$][\w$]*)/gm,
  ))
    value.add(m[1]);
  for (const m of src.matchAll(/export\s+\{([^}]*)\}/g))
    for (const part of m[1].split(",")) {
      const raw = part.trim();
      if (!raw) continue;
      const exported = raw
        .split(/\s+as\s+/)
        .pop()
        .trim()
        .replace(/^type\s+/, "");
      (/^type\s/.test(raw) ? type : value).add(exported);
    }
};

/**
 * f054ab2baf renamed in two ways, and only the first is a suffix strip:
 *   ScenarioClockPort              -> ScenarioClock            (drop `Port`)
 *   IngestionPullLifecycleCommand  -> IngestionPullLifecycleChannel   (swap the last word)
 * So the stem to match on is the name minus its final CamelCase word, and a
 * proposal is any declared name sharing that stem. Matching only the `Port`
 * strip finds the first kind and silently misses the second — which is how the
 * first version of this script reported "nothing declared" for a name whose
 * replacement was sitting two words away.
 */
const stems = (name) => {
  const out = new Set([name]);
  out.add(name.replace(/Port$/, ""));
  const words = name.match(/[A-Z][a-z0-9]*/g) ?? [];
  // Only drop the final word when at least two remain. A one-word stem like
  // "Gateway" matches every symbol in the module and turns a proposal into a
  // 300-name dump, which is worse than no proposal at all.
  if (words.length > 2) out.add(words.slice(0, -1).join(""));
  return [...out].filter(Boolean);
};

const proposals = (name, declared) => {
  const all = new Set([...declared.value, ...declared.type]);
  if (all.has(name)) return [name];
  const out = new Set();
  for (const stem of stems(name)) {
    if (stem !== name && all.has(stem)) out.add(stem);
    for (const candidate of all)
      if (candidate !== name && candidate.startsWith(stem) && candidate.length > stem.length)
        out.add(candidate);
  }
  return [...out];
};

const isGeneratedPackage = (pkgName) => GENERATED.some((pkg) => pkgName.includes(pkg));

const importKind = (name, declared) => {
  if (declared.value.has(name)) return "NOT-EXPORTED";
  return declared.type.has(name) ? "TYPE-ONLY" : "ABSENT";
};

/** Value names in one import list that nothing declares as a value, or the entry does not export. */
const findUnresolvedNames = ({ specifiers, declared, surface }) => {
  const names = [];
  for (const part of specifiers.split(",")) {
    const raw = part.trim();
    if (!raw || /^type\s/.test(raw)) continue;
    const name = raw.split(/\s+as\s+/)[0].trim();
    const exported = surface ? surface.has(name) : true;
    if (!(declared.value.has(name) && exported)) names.push(name);
  }
  return names;
};

/** The unresolvable named imports one source file makes from workspace packages. */
const findFileUnresolvable = ({ file, src, declared, workspace, surfaces }) => {
  const rows = [];
  for (const m of src.matchAll(/import\s+\{([^}]*)\}\s*from\s*["'](@langwatch\/[^"']+)["']/g)) {
    if (isGeneratedPackage(m[2])) continue;
    const pkg = packageOf(m[2]);
    if (workspace && !workspace.has(pkg)) continue;
    // A subpath carries its own export map, which this does not read, so only
    // the bare entry can be judged for NOT-EXPORTED.
    const surface = m[2] === pkg ? surfaces?.get(pkg) : undefined;
    const line = src.slice(0, m.index).split("\n").length;
    for (const name of findUnresolvedNames({ specifiers: m[1], declared, surface })) {
      rows.push({
        file,
        name,
        from: m[2],
        line,
        kind: importKind(name, declared),
        candidates: proposals(name, declared),
      });
    }
  }
  return rows;
};

export const findUnresolvable = (sources, workspace, surfaces) => {
  const declared = collectDeclarations(sources);
  const rows = [];
  for (const [file, src] of sources) {
    rows.push(...findFileUnresolvable({ file, src, declared, workspace, surfaces }));
  }
  return rows;
};

const FIXTURES = [
  {
    want: "TYPE-ONLY",
    name: "an interface imported in value position",
    sources: new Map([
      ["pkg.ts", "export interface GovernanceEncryptor { encrypt(v: string): string }"],
      ["use.ts", 'import { GovernanceEncryptor } from "@langwatch/enterprise-governance-process";'],
    ]),
  },
  {
    want: "ABSENT",
    name: "a name nothing declares",
    sources: new Map([
      ["pkg.ts", "export interface GovernanceDiagnosticsSink { warn(m: string): void }"],
      [
        "use.ts",
        'import { GovernanceDiagnostics } from "@langwatch/enterprise-governance-process";',
      ],
    ]),
  },
  {
    want: null,
    name: "a real class import",
    sources: new Map([
      ["pkg.ts", "export class IngestionPullWorkerService {}"],
      [
        "use.ts",
        'import { IngestionPullWorkerService } from "@langwatch/enterprise-governance-process";',
      ],
    ]),
  },
  {
    want: null,
    name: "an already type-only specifier",
    sources: new Map([
      ["pkg.ts", "export interface IngestionPullSource { id: string }"],
      [
        "use.ts",
        'import { type IngestionPullSource } from "@langwatch/enterprise-governance-process";',
      ],
    ]),
  },
  // A published catalog dependency in the @langwatch scope. Its exports live in
  // node_modules, so a scan of tracked sources cannot see them — reporting it
  // would be the scan describing itself rather than the code. This fixture is
  // here because the first version did exactly that, for every `generate` import
  // from @langwatch/ksuid in the tree.
  {
    want: null,
    name: "an import from a published (non-workspace) @langwatch package",
    workspace: new Set(["@langwatch/enterprise-governance-process"]),
    sources: new Map([["use.ts", 'import { generate } from "@langwatch/ksuid";']]),
  },
  // Declared, exported from its own file, and omitted from the package entry's
  // re-export list. `CodexAccountService` was exactly this and no declaration
  // scan could see it.
  {
    want: "NOT-EXPORTED",
    name: "a class the package's entry does not re-export",
    workspace: new Set(["@langwatch/model-provider-process"]),
    surfaces: new Map([["@langwatch/model-provider-process", new Set(["SomethingElse"])]]),
    sources: new Map([
      ["svc.ts", "export class CodexAccountService {}"],
      ["use.ts", 'import { CodexAccountService } from "@langwatch/model-provider-process";'],
    ]),
  },
  // The same package with the name on its surface must stay silent — the guard
  // against a surface that comes back empty and condemns the whole tree.
  {
    want: null,
    name: "a class the package's entry does re-export",
    workspace: new Set(["@langwatch/model-provider-process"]),
    surfaces: new Map([["@langwatch/model-provider-process", new Set(["CodexAccountService"])]]),
    sources: new Map([
      ["svc.ts", "export class CodexAccountService {}"],
      ["use.ts", 'import { CodexAccountService } from "@langwatch/model-provider-process";'],
    ]),
  },
];

const selfTest = () => {
  let bad = 0;
  for (const fixture of FIXTURES) {
    const rows = findUnresolvable(fixture.sources, fixture.workspace, fixture.surfaces);
    const got = rows.length ? rows[0].kind : null;
    if (got !== fixture.want) {
      console.error(
        `self-test FAILED: ${fixture.name} — expected ${fixture.want ?? "no hit"}, got ${got ?? "no hit"}`,
      );
      bad += 1;
    }
  }
  // The ABSENT fixture must also propose the role-suffixed name.
  const absent = findUnresolvable(FIXTURES[1].sources)[0];
  if (!absent?.candidates.includes("GovernanceDiagnosticsSink")) {
    console.error("self-test FAILED: the role-suffix proposal did not fire");
    bad += 1;
  }
  if (bad) return 2;
  console.log(`self-test passed (${FIXTURES.length} fixtures + the rename proposal)`);
  return 0;
};

const bootRelevant = (file) =>
  !/(^|\/)(__tests__|e2e|tests)\//.test(file) &&
  !/\.(unit|integration)\.test\.tsx?$/.test(file) &&
  !file.startsWith("sdks/") &&
  !file.startsWith("packages/architecture-enforcer/");

const listFiles = (target) => {
  if (!target) {
    return execSync("git ls-files '*.ts' '*.tsx' | grep -vE '(^|/)(node_modules|dist)/'", {
      encoding: "utf8",
      maxBuffer: 1 << 28,
    })
      .trim()
      .split("\n")
      .filter(bootRelevant);
  }
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
    );
  const stats = statSync(target);
  return (stats.isDirectory() ? walk(target) : [target]).filter((f) => /\.tsx?$/.test(f));
};

const target = process.argv[2];
if (target === "--self-test") process.exit(selfTest());
if (selfTest() !== 0) process.exit(2);

// Declarations are collected from the WHOLE tree even when the scan is scoped:
// a name declared outside the scope is still declared.
const all = new Map();
for (const file of listFiles(undefined)) {
  try {
    all.set(file, readFileSync(file, "utf8"));
  } catch {
    /* unreadable */
  }
}
const scope = target ? new Set(listFiles(target)) : null;
const manifests = new Map();
for (const manifest of execSync(
  "git ls-files '*/package.json' | grep -vE '(^|/)(node_modules|dist)/'",
  { encoding: "utf8", maxBuffer: 1 << 28 },
)
  .trim()
  .split("\n")) {
  try {
    manifests.set(manifest, readFileSync(manifest, "utf8"));
  } catch {
    /* unreadable */
  }
}
function renameHint(candidates) {
  if (candidates.length === 1) return `  -> ${candidates[0]}`;
  if (candidates.length) return `  -> one of [${candidates.join(", ")}]`;
  return "  -> nothing declared; port it from history";
}

const rows = findUnresolvable(all, workspacePackages(), exportSurfaces(all, manifests)).filter(
  (r) => !scope || scope.has(r.file),
);

const counts = rows.reduce((acc, r) => ({ ...acc, [r.kind]: (acc[r.kind] ?? 0) + 1 }), {});
const sole = rows.filter((r) => r.candidates.length === 1);
console.error(
  `${rows.length} unresolvable value imports ${JSON.stringify(counts)}; ` +
    `${sole.length} have exactly one rename candidate`,
);
for (const r of rows) {
  console.log(`${r.kind.padEnd(9)} ${r.file}:${r.line}  ${r.name}${renameHint(r.candidates)}`);
}
process.exit(rows.length > 0 ? 1 : 0);
