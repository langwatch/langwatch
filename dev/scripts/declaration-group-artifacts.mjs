import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { artifactsIn } from "./declaration-cache-artifacts.mjs";
import { inside } from "./declaration-cache-inputs.mjs";

const jsonManifest = ".declaration-json-outputs.json";
function writeAtomic(file, contents) {
  const next = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  const current = existsSync(file) ? readFileSync(file) : null;
  if (current && current.equals(next)) {
    return;
  }
  try {
    writeFileSync(temporary, next);
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function sourceJsonFiles(directory, output) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.name === "node_modules" || file === output) {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...sourceJsonFiles(file, output));
    } else {
      const isJsonFile = entry.isFile() && entry.name.endsWith(".json");
      if (isJsonFile) {
        files.push(file);
      }
    }
  }
  return files;
}

function memberPrefix(project, member) {
  const prefix = relative(project.source, member.source);
  const escapes = prefix.startsWith("..") || isAbsolute(prefix);
  if (escapes) {
    throw new Error(`Group member source escapes group source: ${member.source}`);
  }
  return prefix;
}

function memberFor(project, path) {
  const matches = project.members.filter((member) => {
    const prefix = memberPrefix(project, member);
    return path === prefix || path.startsWith(`${prefix}/`);
  });
  if (matches.length !== 1) {
    throw new Error(`Group artifact does not belong to exactly one member: ${path}`);
  }
  return matches[0];
}

function stagingPath(project, file) {
  const path = relative(project.output, file);
  const escapes = path.startsWith("..") || isAbsolute(path);
  if (escapes) {
    throw new Error(`Group artifact escapes staging output: ${file}`);
  }
  return path;
}

function declarationSourceMap(file, destination) {
  const map = JSON.parse(readFileSync(file, "utf8"));
  const root = typeof map.sourceRoot === "string" ? map.sourceRoot : "";
  const sources = Array.isArray(map.sources) ? map.sources : [];
  const absoluteSources = sources.map((source) => resolve(dirname(file), root, source));
  map.sources = absoluteSources.map((source) =>
    relative(dirname(destination), source).replaceAll("\\", "/"),
  );
  if (Object.hasOwn(map, "sourceRoot")) {
    map.sourceRoot = "";
  }
  return JSON.stringify(map);
}

export function copyGroupJsonInputs(project) {
  const paths = [];
  for (const member of project.members) {
    for (const file of sourceJsonFiles(member.source, member.output)) {
      const path = relative(project.source, file);
      const destination = join(project.output, path);
      writeAtomic(destination, readFileSync(file));
      paths.push(path);
    }
  }
  if (paths.length > 0) {
    writeAtomic(join(project.output, jsonManifest), JSON.stringify(paths.sort()));
  }
}

export function distributeGroupArtifacts(project) {
  const staged = artifactsIn(project.output).filter((file) => !file.endsWith(jsonManifest));
  const expected = new Map(project.members.map((member) => [member.output, new Set()]));
  const jsonOutputs = new Map(project.members.map((member) => [member.output, []]));
  const previousOwned = new Map(
    project.members.map((member) => [member.output, artifactsIn(member.output)]),
  );

  for (const file of staged) {
    const path = stagingPath(project, file);
    const member = memberFor(project, path);
    const prefix = memberPrefix(project, member);
    const destination = join(member.output, relative(prefix, path));
    if (!inside(member.output, destination)) {
      throw new Error(`Group artifact escapes member output: ${path}`);
    }
    expected.get(member.output).add(destination);
    if (file.endsWith(".json")) {
      jsonOutputs.get(member.output).push(relative(member.output, destination));
    }
    const contents = /\.d\.(?:c|m)?ts\.map$/.test(file)
      ? declarationSourceMap(file, destination)
      : readFileSync(file);
    writeAtomic(destination, contents);
  }

  for (const member of project.members) {
    const manifest = join(member.output, jsonManifest);
    const jsonPaths = jsonOutputs.get(member.output).sort();
    if (jsonPaths.length > 0) {
      expected.get(member.output).add(manifest);
      writeAtomic(manifest, JSON.stringify(jsonPaths));
    }
    const owned = previousOwned.get(member.output);
    const keep = expected.get(member.output);
    for (const file of owned) {
      if (!keep.has(file)) {
        rmSync(file, { force: true });
      }
    }
  }
}

export function cleanGroupArtifacts(project) {
  for (const member of project.members) {
    for (const file of artifactsIn(member.output)) {
      rmSync(file, { force: true });
    }
  }
}
