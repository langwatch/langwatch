import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

// Each module go.work uses is project go-<dir> (test:go, lint:go, run inside it);
// each main under cmd/ is a project whose `build` writes .bin/<name>/<name>. Edges
// come from each go.mod's in-repo `require` lines and each main's in-repo imports,
// so a change reaches only what builds on it. Inputs and targetDefaults in
// nx.json; ADR-150 records why.
const simulatorConsoles = ["idpsim", "llmsim", "mailsim", "storagesim", "voicesim"].map(
  (name) => `@langwatch/${name}-web`,
);
const consoles = {
  haven: ["@langwatch/haven-web", ...simulatorConsoles],
  service: simulatorConsoles,
};

const moduleName = (root) => `go-${root.replaceAll("/", "-")}`;
const useDirs = (goWork) =>
  [...goWork.matchAll(/^\s*(?:use\s+)?\.\/([^\s)]+)\s*$/gm)].map((match) => match[1]);

const goModule = (root) => ({
  name: moduleName(root),
  tags: ["go"],
  targets: {
    "test:go": { executor: "nx:run-commands", options: { cwd: root, command: "go test ./..." } },
    "lint:go": { command: `make --no-print-directory go-lint GO_LINT_MODULES=${root}` },
    ...(root === "tools" ? { herrgen: { command: "go run ./cmd/herrgen" } } : {}),
  },
});

// .bin/service is the local dev binary: tagged dev, it links the simulators
// (cmd/service/combined_dev.go). Release images build ./cmd/service untagged.
const buildTags = { service: "-tags dev " };

const binary = (root) => {
  const name = basename(root);
  const build = { command: `go build ${buildTags[name] ?? ""}-o .bin/${name}/${name} ./${root}` };
  return {
    name,
    tags: ["go"],
    implicitDependencies: consoles[name] ?? [],
    targets: { build },
  };
};

// A console reaches a binary only through its built output, never its sources.
const consoleInputs = { namedInputs: { goBuild: [] } };

export const createNodes = [
  "{go.work,cmd/*/main.go,infra/clickhouse-serverless/cmd/*/main.go,apps/{haven,idpsim,llmsim,mailsim,storagesim,voicesim}-web/package.json}",
  (files, _options, context) =>
    files.map((file) => {
      if (file.endsWith("package.json"))
        return [file, { projects: { [dirname(file)]: consoleInputs } }];
      if (file !== "go.work")
        return [file, { projects: { [dirname(file)]: binary(dirname(file)) } }];
      const roots = useDirs(readFileSync(join(context.workspaceRoot, file), "utf8"));
      return [file, { projects: Object.fromEntries(roots.map((root) => [root, goModule(root)])) }];
    }),
];

const workspaceModules = (workspaceRoot) =>
  useDirs(readFileSync(join(workspaceRoot, "go.work"), "utf8")).map((root) => ({
    path: readFileSync(join(workspaceRoot, root, "go.mod"), "utf8").match(/^module\s+(\S+)/m)[1],
    project: moduleName(root),
  }));

// A go.mod names a module as `<path> <version>` or `<path> =>`; Go source as "<path>/...".
const names = (text, path) =>
  text.includes(`${path} `) || text.includes(`"${path}"`) || text.includes(`"${path}/`);

export const createDependencies = (_options, context) => {
  const modules = workspaceModules(context.workspaceRoot);
  const edges = [];
  for (const [project, files] of Object.entries(context.fileMap.projectFileMap)) {
    const isModule = modules.some((module) => module.project === project);
    if (!isModule && !context.projects[project]?.tags?.includes("go")) continue;
    for (const { file } of files) {
      const read = isModule
        ? basename(file) === "go.mod"
        : file.endsWith(".go") && !file.endsWith("_test.go");
      if (!read) continue;
      const text = readFileSync(join(context.workspaceRoot, file), "utf8");
      for (const { path, project: target } of modules) {
        if (target !== project && names(text, path)) {
          edges.push({ source: project, target, sourceFile: file, type: "static" });
        }
      }
    }
  }
  return edges;
};
