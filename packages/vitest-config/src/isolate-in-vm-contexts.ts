import { readFileSync } from "node:fs";
import { join, matchesGlob, relative } from "node:path";

import { configDefaults, type ViteUserConfig } from "vitest/config";

import { literalGlob, suiteFiles } from "./suite-files.ts";

type TestOptions = NonNullable<ViteUserConfig["test"]>;
type Project = NonNullable<TestOptions["projects"]>[number];

// A file that asks for Node's environment has no window to share, and a vm
// context gives it a second set of Node globals that native modules reject.
const NODE_ENVIRONMENT = /@(?:vitest|jest)-environment\s+node\b/;

/**
 * A worker restarts once its heap passes this after a file; vitest's default is
 * a share of the machine's memory. Read from the root config only, not a project.
 */
export const VM_MEMORY_LIMIT = "1GB";

// A worker serves the next file only if it is from the same project, so each
// project runs as its own group; shuffled files would otherwise restart them.
const VM_PROJECT: TestOptions = {
  pool: "vmForks",
  sequence: { groupOrder: 1 },
};
const OWN_PROCESS: TestOptions = {
  name: "own-process",
  isolate: true,
  sequence: { groupOrder: 2 },
};

/**
 * Runs a suite's isolated files on `vmForks`: a fresh registry and window per
 * file in a worker that loads jsdom once. Files that cannot run in a vm
 * context keep a process each. See ADR-184.
 */
export function isolateInVmContexts({
  test,
  root,
  needsOwnProcess = [],
}: {
  test: TestOptions;
  root: string;
  needsOwnProcess?: string[];
}): TestOptions {
  const base = test.dir === undefined ? root : join(root, test.dir);
  const ownProcess = (file: string) =>
    needsOwnProcess.some((pattern) => matchesGlob(relative(root, join(base, file)), pattern)) ||
    NODE_ENVIRONMENT.test(readFileSync(join(base, file), "utf8"));

  if (test.projects !== undefined) {
    return {
      ...test,
      vmMemoryLimit: VM_MEMORY_LIMIT,
      projects: test.projects.flatMap((project) =>
        isIsolatedProject(project) ? splitIsolatedProject(project, ownProcess) : [project],
      ),
    };
  }
  if (test.isolate !== true) return test;

  const { include = configDefaults.include, ...inherited } = test;
  const exclude = test.exclude ?? configDefaults.exclude;
  const own = suiteFiles(base, include, exclude).filter(ownProcess);
  if (own.length === 0) return { ...test, pool: "vmForks", vmMemoryLimit: VM_MEMORY_LIMIT };
  const ownGlobs = own.map(literalGlob);
  return {
    ...inherited,
    vmMemoryLimit: VM_MEMORY_LIMIT,
    projects: [
      {
        extends: true,
        test: {
          name: "isolated",
          ...VM_PROJECT,
          include,
          exclude: [...exclude, ...ownGlobs],
        },
      },
      { extends: true, test: { ...OWN_PROCESS, include: ownGlobs } },
    ],
  };
}

function isIsolatedProject(
  project: Project,
): project is { extends: true; test: TestOptions & { include: string[] } } {
  return (
    typeof project === "object" &&
    "test" in project &&
    project.test?.name === "isolated" &&
    Array.isArray(project.test.include)
  );
}

/** The isolated project lists its files literally, so each is checked by name. */
function splitIsolatedProject(
  project: { extends: true; test: TestOptions & { include: string[] } },
  ownProcess: (file: string) => boolean,
): Project[] {
  const files = project.test.include;
  const own = files.filter((glob) => ownProcess(unescapeGlob(glob)));
  const shared = files.filter((glob) => !own.includes(glob));
  const vm: Project = {
    ...project,
    test: { ...project.test, ...VM_PROJECT, include: shared },
  };
  const forks: Project = {
    extends: true,
    test: { ...OWN_PROCESS, include: own },
  };
  if (own.length === 0) return [vm];
  if (shared.length === 0) return [{ ...forks, test: { ...forks.test, name: "isolated" } }];
  return [vm, forks];
}

function unescapeGlob(glob: string): string {
  return glob.replace(/\\(.)/g, "$1");
}
