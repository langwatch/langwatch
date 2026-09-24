import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import ts from "typescript";

/**
 * Derives every TypeScript project reference from the pnpm workspace
 * manifests; a cyclic web-group member produces through the group solution
 * instead of its own `tsconfig.build.json`. Manual overrides live in `langwatchExtraReferences`.
 */

const GROUP_SOLUTION = "dev/tsconfig.web-declarations.json";

/**
 * The workspace solution `pnpm typecheck` builds: it references every member's
 * check root, so one `tsc -b` walks the whole graph and checks each project
 * once instead of one process per package re-walking its own subtree.
 */
const ROOT_SOLUTION = "tsconfig.json";

/**
 * The configs a type-check is run against. Each carries its own `references`
 * because `extends` does not inherit them.
 */
const CHECK_ROOTS = [
  "tsconfig.json",
  "tsconfig.test.json",
  "tsconfig.tests.json",
  "tsconfig.type-tests.json",
] as const;

export type WorkspaceMember = {
  readonly name: string;
  readonly directory: string;
  readonly dependencies: readonly string[];
  readonly developmentDependencies: readonly string[];
  /** Whether the manifest declares a `typecheck` script -- see `checkRootsOf`. */
  readonly checks: boolean;
};

export type DerivedProject = {
  /** Absolute path of the tsconfig whose `references` array this describes. */
  readonly file: string;
  /** Reference paths in order, relative to the config's own directory. */
  readonly references: readonly string[];
  /** Entries the file carries that no rule derives and no extras key keeps. */
  readonly undeducible: readonly string[];
  /** The references the file carries today, for a caller reporting drift. */
  readonly current: readonly string[];
};

type Manifest = {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
};

function readJsonc(file: string): Record<string, unknown> {
  const parsed = ts.parseConfigFileTextToJson(file, readFileSync(file, "utf8"));
  const config: unknown = parsed.config;

  return typeof config === "object" && config !== null ? (config as Record<string, unknown>) : {};
}

function referencePaths(config: Record<string, unknown>, key: string): string[] {
  const value = config[key];
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    const path: unknown = (entry as { path?: unknown })?.path;

    return typeof path === "string" ? [path] : [];
  });
}

function workspaceGlobs(root: string): string[] {
  // The `packages:` block of pnpm-workspace.yaml is a flat list of quoted globs;
  // reading it by hand keeps this derivation free of a YAML dependency.
  const manifest = join(root, "pnpm-workspace.yaml");
  if (!existsSync(manifest)) return [];

  const globs: string[] = [];
  let inside = false;

  for (const line of readFileSync(manifest, "utf8").split("\n")) {
    if (/^packages:\s*$/.test(line)) {
      inside = true;
      continue;
    }

    if (inside && /^\S/.test(line)) break;

    const entry = /^\s+-\s+["']?([^"'#\s]+)["']?\s*$/.exec(line);
    if (inside && entry?.[1]) globs.push(entry[1]);
  }

  return globs;
}

function expandGlob(root: string, pattern: string): string[] {
  let directories = [root];

  for (const segment of pattern.split("/")) {
    const next: string[] = [];

    for (const directory of directories) {
      if (segment !== "*") {
        const candidate = join(directory, segment);
        if (!existsSync(candidate)) continue;

        const candidateStat = statSync(candidate);
        if (!candidateStat.isDirectory()) continue;

        next.push(candidate);
        continue;
      }

      if (!existsSync(directory)) continue;

      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;

        if (entry.name.startsWith(".")) continue;

        if (entry.name === "node_modules") continue;

        next.push(join(directory, entry.name));
      }
    }

    directories = next;
  }

  return directories;
}

function workspaceNames(dependencies: Record<string, string> | undefined): string[] {
  return Object.entries(dependencies ?? {})
    .filter(([, range]) => range.startsWith("workspace:"))
    .map(([name]) => name)
    .toSorted();
}

export function readWorkspaceMembers(root: string): WorkspaceMember[] {
  const members = new Map<string, WorkspaceMember>();

  for (const pattern of workspaceGlobs(root)) {
    for (const directory of expandGlob(root, pattern)) {
      const manifestPath = join(directory, "package.json");
      if (!existsSync(manifestPath)) continue;

      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
      if (!manifest.name) continue;

      members.set(manifest.name, {
        name: manifest.name,
        directory,
        dependencies: workspaceNames(manifest.dependencies),
        developmentDependencies: workspaceNames(manifest.devDependencies),
        checks: typeof manifest.scripts?.typecheck === "string",
      });
    }
  }

  return [...members.values()].toSorted((left, right) => (left.name < right.name ? -1 : 1));
}

function groupMemberDirectories(root: string): Set<string> {
  const solution = join(root, GROUP_SOLUTION);
  if (!existsSync(solution)) return new Set();

  const group = readJsonc(solution).langwatchDeclarationGroup;
  const entries = (group as { members?: { directory?: string }[] } | undefined)?.members ?? [];

  return new Set(
    entries.flatMap((entry) =>
      entry.directory ? [resolve(dirname(solution), entry.directory)] : [],
    ),
  );
}

function relativeReference(from: string, target: string): string {
  return relative(from, target).split(sep).join("/");
}

/** `./tsconfig.build.json` and `tsconfig.build.json` name one project. */
function normalise(reference: string): string {
  return reference.replace(/^\.\//, "");
}

function unique(references: readonly string[]): string[] {
  return [...new Set(references)];
}

/**
 * The project a consumer references for this package's declarations: the
 * build config, unless it emits JS only (`declaration: false`, as
 * `@langwatch/mail` does), in which case `tsconfig.declarations.json` produces.
 */
function producerFile(directory: string): string | undefined {
  const build = join(directory, "tsconfig.build.json");
  if (!existsSync(build)) return void 0;

  const options = readJsonc(build).compilerOptions;
  const emits = (options as { declaration?: unknown } | undefined)?.declaration !== false;
  if (emits) return build;

  const declarations = join(directory, "tsconfig.declarations.json");

  return existsSync(declarations) ? declarations : void 0;
}

/**
 * The projects a member's `typecheck` builds; no script means opted out. A `tsconfig.test.json` is
 * the package's config widened, so it stands in for it; type-test spellings are separate projects.
 */
function checkRootsOf(directory: string): string[] {
  const widened = join(directory, "tsconfig.test.json");
  const base = existsSync(widened) ? widened : join(directory, "tsconfig.json");

  return [
    base,
    join(directory, "tsconfig.tests.json"),
    join(directory, "tsconfig.type-tests.json"),
  ].filter((file) => existsSync(file));
}

type CycleWalk = {
  edges: ReadonlyMap<string, readonly string[]>;
  dropped: ReadonlySet<string>;
  done: Set<string>;
  path: string[];
  onPath: Set<string>;
};

function walkForCycle(walk: CycleWalk, node: string): string[] | undefined {
  const { edges, dropped, done, path, onPath } = walk;
  if (onPath.has(node)) return [...path.slice(path.indexOf(node)), node];

  if (done.has(node)) return void 0;

  path.push(node);
  onPath.add(node);

  for (const next of edges.get(node) ?? []) {
    if (dropped.has(`${node}\n${next}`)) continue;

    const cycle = walkForCycle(walk, next);
    if (cycle) return cycle;
  }

  path.pop();
  onPath.delete(node);
  done.add(node);

  return void 0;
}

function firstCycle(
  edges: ReadonlyMap<string, readonly string[]>,
  dropped: ReadonlySet<string>,
): string[] | undefined {
  const walk: CycleWalk = { edges, dropped, done: new Set(), path: [], onPath: new Set() };

  for (const node of [...edges.keys()].toSorted()) {
    const cycle = walkForCycle(walk, node);
    if (cycle) return cycle;
  }

  return void 0;
}

/**
 * TypeScript project references may not cycle, but package dependencies may:
 * two contracts can each name a type of the other. One edge per cycle is
 * dropped — the first, in order, whose removal leaves the graph acyclic.
 */
function droppedEdges(edges: ReadonlyMap<string, readonly string[]>): Set<string> {
  const dropped = new Set<string>();

  for (let cycle = firstCycle(edges, dropped); cycle; cycle = firstCycle(edges, dropped)) {
    const candidates = cycle.slice(0, -1).map((node, index) => `${node}\n${cycle[index + 1]}`);

    const enough = candidates.find(
      (candidate) => !firstCycle(edges, new Set([...dropped, candidate])),
    );

    dropped.add(enough ?? candidates[0] ?? "");
  }

  return dropped;
}

export function deriveProjects(
  root: string,
  members: readonly WorkspaceMember[],
): DerivedProject[] {
  const groupMembers = groupMemberDirectories(root);
  const groupSolution = join(root, GROUP_SOLUTION);
  const byName = new Map(members.map((member) => [member.name, member]));

  const producerOf = (name: string): string | undefined => {
    const member = byName.get(name);
    if (!member) return void 0;

    const producer = producerFile(member.directory);
    if (!producer) return void 0;

    // The group compiles its members together, so no member's own build config
    // is composite and nothing may reference one directly. Every consumer of a
    // member, inside the group or outside it, produces through the solution.
    if (groupMembers.has(member.directory)) return groupSolution;

    return producer;
  };

  const targetsFor = (names: readonly string[]): string[] =>
    names.flatMap((name) => {
      const producer = producerOf(name);

      return producer ? [producer] : [];
    });

  // The declaration graph as the manifests describe it, the group's own
  // references included, so a cycle is found wherever it runs.
  const buildEdges = new Map<string, string[]>();

  buildEdges.set(
    groupSolution,
    existsSync(groupSolution)
      ? referencePaths(readJsonc(groupSolution), "references").map((path) =>
          resolve(dirname(groupSolution), path),
        )
      : [],
  );

  for (const member of members) {
    const isGroupMember = groupMembers.has(member.directory);
    const producer = producerFile(member.directory);
    if (!producer) continue;

    const edges = isGroupMember ? [groupSolution] : targetsFor(member.dependencies);

    buildEdges.set(
      producer,
      unique(edges).filter((edge) => edge !== producer),
    );
  }

  const dropped = droppedEdges(buildEdges);

  const projects: DerivedProject[] = [];

  for (const member of members) {
    const isGroupMember = groupMembers.has(member.directory);
    const ownProducer = isGroupMember ? groupSolution : producerFile(member.directory);

    // The group compiles its members together, so a member's producer is the group alone.
    const buildTargets = (isGroupMember ? [groupSolution] : targetsFor(member.dependencies)).filter(
      (target) => !dropped.has(`${producerFile(member.directory) ?? ""}\n${target}`),
    );

    const dependencyTargets = unique([
      ...targetsFor(member.dependencies),
      ...targetsFor(member.developmentDependencies),
    ]);

    const consumerTargets = unique([...(ownProducer ? [ownProducer] : []), ...dependencyTargets]);

    // Every config a check runs against carries the graph itself: `extends` does not inherit
    // `references`, so a test config restates what its package's tsconfig.json says, and an
    // application owning no build config still carries them — they are what `tsc -b` walks to reach
    // its dependencies. A build config that emits JavaScript is not in the declaration graph at
    // all, so its references stay as its owner wrote them.
    const build = join(member.directory, "tsconfig.build.json");

    const kinds: readonly { file: string; targets: string[] }[] = [
      ...(ownProducer === build || isGroupMember
        ? [{ file: build, targets: unique(buildTargets) }]
        : []),
      ...CHECK_ROOTS.map((name) => ({
        file: join(member.directory, name),
        targets: consumerTargets,
      })),
      ...(ownProducer && ownProducer !== build && !isGroupMember
        ? [
            {
              file: ownProducer,
              targets: dependencyTargets.filter((target) => target !== ownProducer),
            },
          ]
        : []),
    ];

    for (const kind of kinds) {
      if (!existsSync(kind.file)) continue;

      const directory = dirname(kind.file);
      const config = readJsonc(kind.file);
      const extras = referencePaths(config, "langwatchExtraReferences");

      const derived = kind.targets
        .filter((target) => target !== kind.file)
        .map((target) => relativeReference(directory, target));

      const references = unique([...derived, ...extras.map(normalise)]);
      const current = referencePaths(config, "references").map(normalise);

      projects.push({
        file: kind.file,
        references,
        undeducible: current.filter((entry) => !references.includes(entry)),
        current,
      });
    }
  }

  const solution = join(root, ROOT_SOLUTION);

  if (existsSync(solution)) {
    const config = readJsonc(solution);

    const derived = unique(
      members.filter((member) => member.checks).flatMap((member) => checkRootsOf(member.directory)),
    ).map((file) => relativeReference(root, file));

    // A check root that is not a workspace member of its own -- the mail
    // preview studio is the one -- is named here rather than derived.
    const references = unique([
      ...derived,
      ...referencePaths(config, "langwatchExtraReferences").map(normalise),
    ]);

    projects.push({
      file: solution,
      references,
      undeducible: [],
      current: referencePaths(config, "references").map(normalise),
    });
  }

  return projects;
}

export function deriveWorkspaceReferences(root: string): DerivedProject[] {
  return deriveProjects(root, readWorkspaceMembers(root));
}

function indentUnitOf(text: string): string {
  const indented = /\n([ \t]+)\S/.exec(text);

  return indented?.[1] ?? "  ";
}

function lineIndentAt(text: string, position: number): string {
  const start = text.lastIndexOf("\n", position) + 1;
  const line = text.slice(start, position);

  return /^[ \t]*$/.test(line) ? line : "";
}

function renderArray(references: readonly string[], indent: string, unit: string): string {
  if (references.length === 0) return "[]";

  const entries = references.map(
    (path) =>
      `${indent}${unit}{\n${indent}${unit}${unit}"path": ${JSON.stringify(path)}\n${indent}${unit}}`,
  );

  return `[\n${entries.join(",\n")}\n${indent}]`;
}

function referencesProperty(source: ts.JsonSourceFile): ts.PropertyAssignment | undefined {
  const root = source.statements[0]?.expression;
  if (!root || !ts.isObjectLiteralExpression(root)) return void 0;

  return root.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) &&
      ts.isStringLiteral(property.name) &&
      property.name.text === "references",
  );
}

/** Replaces only the `references` array, so every other byte of the file survives. */
export function renderReferences(text: string, references: readonly string[]): string {
  const source = ts.parseJsonText("tsconfig.json", text);
  const property = referencesProperty(source);
  const unit = indentUnitOf(text);

  if (property) {
    const start = property.initializer.getStart(source);
    const indent = lineIndentAt(text, property.getStart(source));

    return `${text.slice(0, start)}${renderArray(references, indent, unit)}${text.slice(property.initializer.end)}`;
  }

  if (references.length === 0) return text;

  const closing = text.lastIndexOf("}");
  const body = text.slice(0, closing).replace(/\s*$/, "");
  const insertion = `${unit}"references": ${renderArray(references, unit, unit)}`;
  const separator = /[[{]\s*$/.test(body) ? "" : ",";

  return `${body}${separator}\n${insertion}\n${text.slice(closing)}`;
}
