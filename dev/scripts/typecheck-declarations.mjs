#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { artifactsIn, copyJsonInputs, publish, restore } from "./declaration-cache-artifacts.mjs";
import { createInputHasher, digest, projectsFor } from "./declaration-cache-inputs.mjs";
import {
  cleanGroupArtifacts,
  copyGroupJsonInputs,
  distributeGroupArtifacts,
} from "./declaration-group-artifacts.mjs";

const root = process.cwd();
const options = process.argv.slice(2);
const projectIndex = options.findIndex((option) => option === "--project" || option === "-p");
// A relative `--project` names the calling package's own config: pnpm sets INIT_CWD
// to the directory the script ran from, so `--project .` is the same line everywhere.
function projectFrom(value) {
  if (typeof value !== "string" || !value.startsWith(".")) return value;

  const target = resolve(process.env.INIT_CWD ?? root, value);

  return existsSync(target) && statSync(target).isDirectory()
    ? join(target, "tsconfig.json")
    : target;
}

const solution = projectFrom(
  projectIndex === -1 ? "dev/tsconfig.declarations.json" : options[projectIndex + 1],
);
if (projectIndex !== -1) {
  options.splice(projectIndex, 2);
}

function compiler(args) {
  return new Promise((done) => {
    const child = spawn("pnpm", ["exec", "tsc", ...args], {
      cwd: root,
      stdio: "inherit",
    });
    const handlers = new Map(
      ["SIGINT", "SIGTERM", "SIGHUP"].map((signal) => [signal, () => child.kill(signal)]),
    );
    for (const [signal, handler] of handlers) {
      process.on(signal, handler);
    }
    child.on("error", (error) => {
      console.error(error.message);
      done(1);
    });
    child.on("exit", (code, signal) => {
      for (const [name, handler] of handlers) {
        process.off(name, handler);
      }
      done(signal ? 1 : (code ?? 1));
    });
  });
}

async function main() {
  const started = performance.now();
  if (!solution || solution.startsWith("-")) {
    throw new Error("--project requires a TypeScript solution config path.");
  }
  const compilerMode = options.some((option) =>
    ["--clean", "--watch", "-w", "--dry", "--help", "-h"].includes(option),
  );
  if (compilerMode) {
    return runSolutionMode();
  }
  const projects = projectsFor(root, solution);
  const common = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd: root,
    encoding: "utf8",
  });
  const namespace = common.status === 0 ? common.stdout.trim() : root;
  const homeCache =
    process.env.XDG_CACHE_HOME ??
    (process.platform === "darwin" ? join(homedir(), "Library/Caches") : join(homedir(), ".cache"));
  const cache = resolve(
    process.env.LANGWATCH_DECLARATION_CACHE_DIR ??
      join(homeCache, "langwatch/declarations", digest(namespace).slice(0, 20)),
  );
  const force = options.includes("--force") || options.includes("-f");
  const flags = options.filter(
    (option) => !["--force", "-f", "--verbose", "-v", "--stopBuildOnErrors"].includes(option),
  );
  const externalInputs = new Map();
  const strict = process.env.LANGWATCH_DECLARATION_CACHE_STRICT === "1";
  const inputs = createInputHasher(root, projects, flags, strict, externalInputs);
  const build = { projects, flags, strict, externalInputs, cache };
  const result = await buildProjects(build, inputs, force);
  if (result.code !== 0) {
    return result.code;
  }
  console.error(
    `Declarations: ${result.built} built, ${result.hits} cached (${((performance.now() - started) / 1000).toFixed(2)}s elapsed).`,
  );
  return 0;
}

async function buildProjects(build, inputs, force) {
  const { projects, flags, strict, externalInputs, cache } = build;
  let hits = 0;
  let built = 0;
  const checked = new Map();
  for (const project of projects) {
    const key = inputs(project);
    checked.set(project, key);
    if (!force && restore(cache, key, project)) {
      if (project.members) {
        distributeGroupArtifacts(project);
      }
      hits += 1;
      continue;
    }
    const code = await buildProject(project, key, build);
    if (code !== 0) {
      return { code };
    }
    if (project.members) {
      distributeGroupArtifacts(project);
    }
    built += 1;
  }
  const finalInputs = createInputHasher(root, projects, flags, strict, externalInputs);
  for (const [project, key] of checked) {
    if (finalInputs(project) !== key) {
      console.error(
        `Declaration inputs changed during the build: ${project.configFile}. Run typecheck again.`,
      );
      return { code: 1 };
    }
  }
  return { code: 0, hits, built };
}

async function runSolutionMode() {
  const projects = projectsFor(root, solution);
  const watch = options.includes("--watch") || options.includes("-w");
  if (watch && projects.some((project) => project.members)) {
    throw new Error(
      "Declaration groups require a completed build before distribution; use typecheck:declarations without --watch.",
    );
  }
  const code = await compiler(["--build", solution, "--stopBuildOnErrors", ...options]);
  const clean = code === 0 && options.includes("--clean");
  if (clean) {
    for (const project of projects) {
      if (project.members) {
        cleanGroupArtifacts(project);
      }
      for (const file of artifactsIn(project.output)) {
        rmSync(file);
      }
    }
  }
  return code;
}

async function buildProject(project, key, build) {
  // A miss builds one project: -b would rebuild restored dependencies without build info.
  rmSync(project.buildInfo, { force: true });
  for (const file of artifactsIn(project.output)) {
    rmSync(file);
  }
  const code = await compiler(["--project", project.configFile, ...build.flags]);
  if (code !== 0) {
    return code;
  }
  if (project.members) {
    copyGroupJsonInputs(project);
  } else {
    copyJsonInputs(project);
  }
  const freshInputs = createInputHasher(
    root,
    build.projects,
    build.flags,
    build.strict,
    build.externalInputs,
  );
  if (freshInputs(project) !== key) {
    console.error(
      `Declaration inputs changed during compilation: ${project.configFile}. Run typecheck again.`,
    );
    return 1;
  }
  try {
    publish(build.cache, key, project, root);
  } catch (error) {
    console.error(
      `Declaration cache could not save ${dirname(project.configFile)}: ${error.message}`,
    );
  }
  return 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(`Declaration build failed: ${error.message}`);
  process.exitCode = 1;
}
