import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export const digest = (contents) => createHash("sha256").update(contents).digest("hex");
const ignoredDirectories = new Set([
  "node_modules",
  ".git",
  ".cache",
  ".turbo",
  ".next",
  "coverage",
]);

export function readJson(file) {
  const withoutComments = readFileSync(file, "utf8").replace(
    /"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
    (token) => (token.startsWith('"') ? token : " "),
  );
  return JSON.parse(
    withoutComments.replace(/"(?:\\.|[^"\\])*"|,\s*(?=[}\]])/g, (token) =>
      token.startsWith('"') ? token : "",
    ),
  );
}

export function inside(directory, file) {
  const path = relative(directory, file);
  return path !== ".." && !path.startsWith("../") && !isAbsolute(path);
}

function groupMember(root, directory, source, member) {
  const memberDirectory = resolve(directory, member.directory);
  const memberSource = resolve(memberDirectory, member.source);
  const memberOutput = resolve(memberDirectory, member.output);
  const invalidPackageDirectory =
    !inside(root, memberDirectory) || !existsSync(join(memberDirectory, "package.json"));
  const invalidSourceDirectory =
    !inside(memberDirectory, memberSource) || !inside(source, memberSource);
  const invalidOutputDirectory =
    !inside(memberDirectory, memberOutput) ||
    memberOutput === memberDirectory ||
    memberOutput === memberSource;
  const invalidMember = invalidPackageDirectory || invalidSourceDirectory || invalidOutputDirectory;
  if (invalidMember) {
    throw new Error(`Invalid declaration group member: ${member.directory}`);
  }
  return {
    directory: memberDirectory,
    source: memberSource,
    output: memberOutput,
  };
}

function outputProject(root, configFile, config) {
  const options = config.compilerOptions;
  const missingOutput =
    !options?.emitDeclarationOnly ||
    !options.rootDir ||
    !options.outDir ||
    !options.tsBuildInfoFile;
  if (missingOutput) {
    throw new Error(`Declaration cache requires explicit declaration outputs: ${configFile}`);
  }
  const directory = dirname(configFile);
  const source = resolve(directory, options.rootDir);
  const output = resolve(directory, options.outDir);
  const buildInfo = resolve(directory, options.tsBuildInfoFile);
  const group = config.langwatchDeclarationGroup;
  const members = group
    ? group.members?.map((member) => groupMember(root, directory, source, member))
    : void 0;
  if (group && (!Array.isArray(members) || members.length === 0)) {
    throw new Error(`Declaration group requires members: ${configFile}`);
  }
  const outputEscapes =
    !inside(root, directory) || output === directory || !inside(directory, output);
  if (outputEscapes) {
    throw new Error(`Declaration outputs must stay inside their package: ${configFile}`);
  }
  if (!inside(output, buildInfo)) {
    throw new Error(`Declaration build info must stay inside outDir: ${configFile}`);
  }
  return { configFile, directory, source, output, buildInfo, ...(members ? { members } : {}) };
}

function visitProject(file, graph) {
  let configFile = realpathSync(resolve(file));
  const directory = statSync(configFile).isDirectory();
  if (directory) {
    configFile = join(configFile, "tsconfig.json");
  }
  if (graph.active.has(configFile)) {
    throw new Error(`Circular declaration project reference: ${configFile}`);
  }
  if (graph.visited.has(configFile)) {
    return;
  }
  graph.active.add(configFile);
  const config = readJson(configFile);
  for (const reference of config.references ?? []) {
    visitProject(resolve(dirname(configFile), reference.path), graph);
  }
  graph.active.delete(configFile);
  graph.visited.add(configFile);
  const solutionOnly = config.files?.length === 0 && !config.include;
  if (solutionOnly || config.compilerOptions?.noEmit === true) {
    return;
  }
  graph.projects.push(outputProject(graph.root, configFile, config));
}

export function projectsFor(root, solution) {
  const graph = { root: realpathSync(root), projects: [], visited: new Set(), active: new Set() };
  visitProject(resolve(graph.root, solution), graph);
  return graph.projects;
}

function dependencyDirectory(directory, name) {
  for (let current = directory; ; current = dirname(current)) {
    const candidate = join(current, "node_modules", name);
    const installed = existsSync(join(candidate, "package.json"));
    if (installed) {
      return realpathSync(candidate);
    }
    if (current === dirname(current)) {
      return null;
    }
  }
}

function hashDirectory(current, tree) {
  const real = realpathSync(current);
  if (tree.active.has(real)) {
    throw new Error(`Circular input symlink: ${current}`);
  }
  tree.active.add(real);
  const entries = readdirSync(current, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const entry of entries) {
    const file = join(current, entry.name);
    const ignored =
      ignoredDirectories.has(entry.name) ||
      tree.outputs.has(file) ||
      entry.name.endsWith(".tsbuildinfo");
    if (ignored) {
      continue;
    }
    const stat = statSync(file);
    if (stat.isDirectory()) {
      hashDirectory(file, tree);
    } else if (stat.isFile()) {
      tree.hash.update(
        JSON.stringify([relative(tree.directory, file), digest(readFileSync(file))]),
      );
    }
  }
  tree.active.delete(real);
}

function treeHash(directory, outputs) {
  const tree = { directory, outputs, hash: createHash("sha256"), active: new Set() };
  hashDirectory(directory, tree);
  return tree.hash.digest("hex");
}

function packageIdentity(directory, manifest, workspace, root) {
  if (workspace) {
    return relative(root, directory);
  }
  const index = directory.indexOf("/node_modules/");
  return index === -1 ? `${manifest.name}@${manifest.version}` : directory.slice(index + 1);
}

function developmentInputs(directory, manifest) {
  return Object.keys(manifest.devDependencies ?? {})
    .sort()
    .map((name) => {
      const target = dependencyDirectory(directory, name);
      return [name, target ? digest(readFileSync(join(target, "package.json"))) : null];
    });
}

function packageInputs(directory, graph) {
  if (graph.packages.has(directory)) {
    return graph.packages.get(directory);
  }
  const manifest = readJson(join(directory, "package.json"));
  const workspace =
    inside(graph.root, directory) &&
    !relative(graph.root, directory).split("/").includes("node_modules");
  const dependencies = {
    ...manifest.dependencies,
    ...manifest.optionalDependencies,
    ...manifest.peerDependencies,
  };
  const edges = Object.keys(dependencies)
    .sort()
    .map((name) => [name, dependencyDirectory(directory, name)]);
  const compiler =
    manifest.name === "typescript" || manifest.name?.startsWith("@typescript/typescript-");
  const hashContents = workspace || compiler || graph.strict;
  const contents = hashContents
    ? treeHash(directory, graph.outputs)
    : digest(readFileSync(join(directory, "package.json")));
  const development = workspace ? developmentInputs(directory, manifest) : [];
  const value = {
    identity: packageIdentity(directory, manifest, workspace, graph.root),
    hash: digest(JSON.stringify([contents, development])),
    edges,
  };
  graph.packages.set(directory, value);
  if (!workspace && !graph.strict) {
    graph.externalInputs.set(directory, value);
  }
  return value;
}

function globalHash(root, outputs) {
  const files = readdirSync(root).filter((name) =>
    /^(?:tsconfig.*\.json|package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|\.npmrc|\.pnpmfile\.cjs)$/.test(
      name,
    ),
  );
  const inputs = files.sort().map((name) => [name, digest(readFileSync(join(root, name)))]);
  for (const file of [
    "declaration-cache-inputs.mjs",
    "declaration-cache-artifacts.mjs",
    "declaration-group-artifacts.mjs",
    "typecheck-declarations.mjs",
  ]) {
    inputs.push([file, digest(readFileSync(fileURLToPath(new URL(file, import.meta.url))))]);
  }
  for (const directory of ["patches", "pnpm/patches"]) {
    const path = join(root, directory);
    if (existsSync(path)) {
      inputs.push([directory, treeHash(path, outputs)]);
    }
  }
  return digest(JSON.stringify(inputs));
}

function collectConfig(file, state) {
  if (state.configs.has(file)) {
    return;
  }
  state.configs.add(file);
  const identity = inside(state.graph.root, file)
    ? relative(state.graph.root, file)
    : file.slice(file.indexOf("/node_modules/") + 1);
  state.inputs.push([identity, digest(readFileSync(file))]);
  const config = readJson(file);
  const bases = typeof config.extends === "string" ? [config.extends] : (config.extends ?? []);
  for (const base of bases) {
    const local = base.startsWith(".") || isAbsolute(base);
    const target = local ? resolve(dirname(file), base) : createRequire(file).resolve(base);
    collectConfig(existsSync(target) ? target : `${target}.json`, state);
  }
}

function collectReferences(directory, state) {
  const adopted = state.graph.byDirectory.get(directory);
  if (!adopted) {
    return;
  }
  collectConfig(adopted.configFile, state);
  // Tooling project references need not also appear in package.json.
  for (const reference of readJson(adopted.configFile).references ?? []) {
    const target = resolve(dirname(adopted.configFile), reference.path);
    const referenced = state.graph.projects.find(
      (candidate) =>
        candidate.configFile === target ||
        candidate.directory === target ||
        candidate.members?.some(
          (member) =>
            member.directory === target ||
            join(member.directory, "tsconfig.build.json") === target ||
            dirname(target) === member.directory,
        ),
    );
    if (referenced) {
      if (referenced.members) {
        for (const member of referenced.members) {
          collectPackage(member.directory, state);
        }
      } else {
        collectPackage(referenced.directory, state);
      }
    }
  }
}

function collectPackage(directory, state) {
  if (state.visited.has(directory)) {
    return;
  }
  state.visited.add(directory);
  const value = packageInputs(directory, state.graph);
  const edges = value.edges.map(([name, target]) => [
    name,
    target ? packageInputs(target, state.graph).identity : null,
  ]);
  state.inputs.push([value.identity, value.hash, edges]);
  for (const [, target] of value.edges) {
    if (target) {
      collectPackage(target, state);
    }
  }
  collectReferences(directory, state);
}

function projectHash(project, graph) {
  const state = { graph, visited: new Set(), inputs: [], configs: new Set() };
  if (project.members) {
    for (const member of project.members) {
      collectPackage(member.directory, state);
    }
  } else {
    collectPackage(project.directory, state);
  }
  collectConfig(project.configFile, state);
  collectPackage(graph.compiler, state);
  for (const directory of graph.ambient) {
    collectPackage(directory, state);
  }
  state.inputs.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return digest(
    JSON.stringify([
      "declarations-v1",
      graph.strict,
      process.platform,
      process.arch,
      graph.globalHash,
      relative(graph.root, project.configFile),
      graph.options,
      state.inputs,
    ]),
  );
}

export function createInputHasher(
  root,
  projects,
  options = [],
  strict = process.env.LANGWATCH_DECLARATION_CACHE_STRICT === "1",
  externalInputs = new Map(),
) {
  root = realpathSync(root);
  const outputs = new Set(
    projects.flatMap((project) => [
      project.output,
      ...(project.members?.map((member) => member.output) ?? []),
    ]),
  );
  const ambientDirectory = join(root, "node_modules/@types");
  const ambient = existsSync(ambientDirectory)
    ? readdirSync(ambientDirectory).map((name) => realpathSync(join(ambientDirectory, name)))
    : [];
  const compiler = dependencyDirectory(root, "typescript");
  if (!compiler) {
    throw new Error("Install workspace dependencies before building declarations.");
  }
  const graph = {
    root,
    projects,
    outputs,
    options,
    strict,
    externalInputs,
    compiler,
    ambient,
    packages: new Map(strict ? [] : externalInputs),
    byDirectory: new Map(
      projects.flatMap((project) => [
        [project.directory, project],
        ...(project.members?.map((member) => [member.directory, project]) ?? []),
      ]),
    ),
    globalHash: globalHash(root, outputs),
  };
  return (project) => projectHash(project, graph);
}
