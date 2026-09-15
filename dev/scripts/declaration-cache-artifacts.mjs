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
import { dirname, join, relative } from "node:path";
import { digest, inside } from "./declaration-cache-inputs.mjs";

const isDeclaration = (file) => /\.d\.(?:c|m)?ts(?:\.map)?$/.test(file);
const jsonManifest = ".declaration-json-outputs.json";
const isArtifact = (file) => isDeclaration(file) || file.endsWith(".json");

function ownedJson(directory) {
  const manifest = join(directory, jsonManifest);
  if (!existsSync(manifest)) {
    return [];
  }
  const paths = JSON.parse(readFileSync(manifest, "utf8"));
  return paths
    .map((path) => {
      const file = join(directory, path);
      const invalid = !inside(directory, file) || !path.endsWith(".json");
      if (invalid) {
        throw new Error(`Invalid local declaration JSON path: ${path}`);
      }
      return file;
    })
    .filter(existsSync)
    .concat(manifest);
}

export function artifactsIn(directory) {
  if (!existsSync(directory)) {
    return [];
  }
  const declarations = readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && isDeclaration(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
  return declarations.concat(ownedJson(directory));
}

function jsonInputs(directory, project) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    const ignored = entry.name === "node_modules" || file === project.output;
    if (ignored) {
      continue;
    }
    const jsonFile = entry.isFile() && entry.name.endsWith(".json");
    if (entry.isDirectory()) {
      files.push(...jsonInputs(file, project));
    } else if (jsonFile) {
      files.push(file);
    }
  }
  return files;
}

export function copyJsonInputs(project) {
  const inputs = jsonInputs(project.source, project);
  const paths = [];
  for (const file of inputs) {
    const path = relative(project.source, file);
    const destination = join(project.output, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, readFileSync(file));
    paths.push(path);
  }
  if (paths.length > 0) {
    writeFileSync(join(project.output, jsonManifest), JSON.stringify(paths.sort()));
  }
}

function validated(entry) {
  try {
    const encoded = readFileSync(join(entry, "manifest.json"));
    const expectedDigest = readFileSync(join(entry, "manifest.sha256"), "utf8");
    if (digest(encoded) !== expectedDigest) {
      return null;
    }
    const manifest = JSON.parse(encoded);
    if (manifest.version !== 1 || !Array.isArray(manifest.files) || manifest.files.length === 0) {
      return null;
    }
    const files = manifest.files.map(({ path, hash }) => {
      const file = join(entry, "files", path);
      const invalidPath =
        typeof path !== "string" || !inside(join(entry, "files"), file) || !isArtifact(path);
      if (invalidPath) {
        throw new Error("Invalid declaration cache path");
      }
      const contents = readFileSync(file);
      if (digest(contents) !== hash) {
        throw new Error("Invalid declaration cache checksum");
      }
      return { path, contents };
    });
    return files;
  } catch {
    return null;
  }
}

export function restore(cache, key, project) {
  const files = validated(join(cache, key));
  if (!files) {
    return false;
  }
  const expected = new Set(files.map(({ path }) => join(project.output, path)));
  const stale = artifactsIn(project.output).filter((file) => !expected.has(file));
  const changed = files.filter(({ path, contents }) => {
    const destination = join(project.output, path);
    return !existsSync(destination) || !readFileSync(destination).equals(contents);
  });
  if (stale.length > 0 || changed.length > 0) {
    rmSync(project.buildInfo, { force: true });
  }
  for (const file of stale) {
    rmSync(file);
  }
  for (const { path, contents } of changed) {
    const destination = join(project.output, path);
    mkdirSync(dirname(destination), { recursive: true });
    const temporary = `${destination}.${randomUUID()}.tmp`;
    writeFileSync(temporary, contents);
    renameSync(temporary, destination);
  }
  return true;
}

export function publish(cache, key, project, root) {
  const files = artifactsIn(project.output);
  if (files.length === 0) {
    return;
  }
  const entry = join(cache, key);
  if (validated(entry)) {
    return;
  }
  mkdirSync(cache, { recursive: true });
  const temporary = join(cache, `.${key}.${randomUUID()}`);
  mkdirSync(join(temporary, "files"), { recursive: true });
  try {
    const manifest = { version: 1, files: [] };
    for (const file of files) {
      const contents = readFileSync(file);
      // Absolute paths in declarations/maps are not portable between worktrees.
      const absoluteDeclaration = isDeclaration(file) && contents.includes(root);
      if (absoluteDeclaration) {
        return;
      }
      const path = relative(project.output, file);
      const destination = join(temporary, "files", path);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, contents);
      manifest.files.push({ path, hash: digest(contents) });
    }
    const encoded = JSON.stringify(manifest);
    writeFileSync(join(temporary, "manifest.json"), encoded);
    writeFileSync(join(temporary, "manifest.sha256"), digest(encoded));
    try {
      renameSync(temporary, entry);
    } catch (error) {
      if (!validated(entry)) {
        throw error;
      }
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
