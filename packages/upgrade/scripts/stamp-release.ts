import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { z } from "zod";

import { parseImageCodeSteps } from "../src/gate/image-code-steps.ts";
import { stampTreeRelease } from "../src/gate/image-tree.ts";
import {
  compareReleases,
  manifestStepSchema,
  ownerFromTables,
  parseManifests,
  releaseManifestSchema,
  RELEASES_DIRECTORY,
  tablesTouched,
} from "../src/manifest/index.ts";
import type { ManifestStep, ReleaseTreeSteps } from "../src/manifest/index.ts";

const PRISMA_DIRECTORY = "packages/prisma-client/prisma/migrations";
const GOOSE_DIRECTORY = "packages/clickhouse-migrations/migrations";
const CODE_STEPS_FILE = "packages/upgrade/releases/image/code-steps.json";
const GOOSE_FILE = /^\d{5}_[^/]*\.sql$/;
const TAG_PREFIX = "langwatch@v";

const { values: options } = parseArgs({
  options: {
    release: { type: "string" },
    previous: { type: "string" },
    tree: { type: "string" },
    "cut-at": { type: "string" },
    declared: { type: "string" },
    "table-owners": { type: "string" },
    out: { type: "string" },
  },
});

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

/** Lists a directory and reads a file, in the working tree or at a git ref. */
interface TreeReader {
  prismaDirectory: string;
  gooseDirectory: string;
  list(directory: string): string[];
  read(path: string): string;
  has(path: string): boolean;
}

function workingTree(): TreeReader {
  return {
    prismaDirectory: PRISMA_DIRECTORY,
    gooseDirectory: GOOSE_DIRECTORY,
    list: (directory) =>
      existsSync(join(root, directory)) ? readdirSync(join(root, directory)).toSorted() : [],
    read: (path) => readFileSync(join(root, path), "utf8"),
    has: (path) => existsSync(join(root, path)),
  };
}

/** A ref may predate today's layout, so its directories are found by shape, not by path. */
function gitTree(ref: string): TreeReader {
  const paths = git(["ls-tree", "-r", "--name-only", ref]).split("\n");
  const lock = paths.find((path) => path.endsWith("/prisma/migrations/migration_lock.toml"));
  const gooseCounts = new Map<string, number>();
  for (const path of paths) {
    const slash = path.lastIndexOf("/");
    if (GOOSE_FILE.test(path.slice(slash + 1))) {
      const directory = path.slice(0, slash);
      gooseCounts.set(directory, (gooseCounts.get(directory) ?? 0) + 1);
    }
  }
  const goose = [...gooseCounts].toSorted((left, right) => right[1] - left[1])[0]?.[0];
  return {
    prismaDirectory: lock ? lock.slice(0, lock.lastIndexOf("/")) : PRISMA_DIRECTORY,
    gooseDirectory: goose ?? GOOSE_DIRECTORY,
    list: (directory) =>
      git(["ls-tree", "--name-only", ref, `${directory}/`])
        .split("\n")
        .filter(Boolean)
        .map((path) => path.slice(directory.length + 1)),
    read: (path) => git(["show", `${ref}:${path}`]),
    has: (path) => paths.includes(path),
  };
}

/** The tree's code steps: the committed list the image's gates read, or the `--declared` file. */
function codeStepsOf(reader: TreeReader): ManifestStep[] {
  if (options.declared) {
    return z
      .array(manifestStepSchema)
      .parse(JSON.parse(readFileSync(resolve(options.declared), "utf8")));
  }
  if (!reader.has(CODE_STEPS_FILE)) return [];
  return parseImageCodeSteps({ name: CODE_STEPS_FILE, text: reader.read(CODE_STEPS_FILE) });
}

function readTree(reader: TreeReader) {
  const prisma = { directory: reader.prismaDirectory, names: reader.list(reader.prismaDirectory) };
  const goose = { directory: reader.gooseDirectory, names: reader.list(reader.gooseDirectory) };
  const steps: ReleaseTreeSteps = {
    prismaFolders: prisma.names.filter((name) => /^\d{14}_/.test(name)),
    gooseFiles: goose.names.filter((name) => name.endsWith(".sql")),
    codeSteps: codeStepsOf(reader),
  };
  const sqlOf = ({ id }: { id: string }): string => {
    const [kind, name] = id.split(":");
    if (kind === "prisma") return reader.read(`${prisma.directory}/${name}/migration.sql`);
    const file = goose.names.find((candidate) => candidate.startsWith(`${name}_`));
    return file ? reader.read(`${goose.directory}/${file}`) : "";
  };
  return { steps, sqlOf };
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(resolve(path), "utf8"));
}

const reader = options.tree ? gitTree(options.tree) : workingTree();
const release =
  options.release ??
  z
    .object({ ".": z.string() })
    .parse(JSON.parse(reader.read(".github/.release-please-manifest.json")))["."];
const previous =
  options.previous ??
  git(["tag", "--list", `${TAG_PREFIX}*`])
    .split("\n")
    .map((tag) => tag.slice(TAG_PREFIX.length))
    .filter((version) => /^\d+\.\d+\.\d+$/.test(version))
    .filter((version) => compareReleases({ left: version, right: release }) < 0)
    .toSorted((left, right) => compareReleases({ left, right }))
    .at(-1) ??
  null;

const tableOwners = new Map(
  Object.entries(
    options["table-owners"]
      ? z.record(z.string(), z.string()).parse(readJson(options["table-owners"]))
      : {},
  ),
);

const out = resolve(options.out ?? RELEASES_DIRECTORY);
const earlier = parseManifests({
  files: (existsSync(out) ? readdirSync(out) : [])
    .filter((name) => name.endsWith(".json") && name !== `${release}.json`)
    .map((name) => ({ name, text: readFileSync(join(out, name), "utf8") })),
}).filter((manifest) => compareReleases({ left: manifest.release, right: release }) < 0);

const current = readTree(reader);
const cutAt =
  options["cut-at"] ?? git(["log", "-1", "--format=%cI", options.tree ?? "HEAD"]).trim();

const stamped = stampTreeRelease({
  release,
  previous,
  cutAt,
  tree: current.steps,
  earlier,
  ownerOf: ({ id }) =>
    tableOwners.size === 0
      ? null
      : ownerFromTables({ tables: tablesTouched({ sql: current.sqlOf({ id }) }), tableOwners }),
});
if (stamped.refusal) {
  const { code, message } = stamped.refusal;
  process.stderr.write(`refused to stamp ${release} [${code}]: ${message}\n`);
  process.exit(1);
}
const manifest = releaseManifestSchema.parse(stamped.manifest);
const target = join(out, `${release}.json`);
writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(
  `stamped ${release} (previous ${previous ?? "none"}): ${manifest.steps.length} steps -> ${target}\n`,
);
