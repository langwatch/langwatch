import { basename, dirname } from "node:path";

// The root Go module is project `go` (test:go, lint:go); each main package under
// cmd/ is a project whose `build` writes .bin/<name>/<name>. Every binary depends
// on `go`, which owns the Go trees, so any Go change marks them all affected.
// Cache, inputs and outputs live in nx.json's targetDefaults; ADR-150 records why.
const consoles = {
  haven: ["@langwatch/haven-web", "@langwatch/idpsim-web", "@langwatch/mailsim-web"],
  service: ["@langwatch/idpsim-web", "@langwatch/mailsim-web"],
};

const goModule = {
  name: "go",
  tags: ["go"],
  targets: {
    "test:go": { command: "go test ./..." },
    "lint:go": { command: "make --no-print-directory go-lint" },
    herrgen: { command: "go run ./cmd/herrgen" },
  },
};

const binary = (root) => {
  const name = basename(root);
  const build = { command: `go build -o .bin/${name}/${name} ./${root}` };
  return {
    name,
    tags: ["go"],
    implicitDependencies: ["go", ...(consoles[name] ?? [])],
    targets: { build },
  };
};

export const createNodes = [
  "{go.mod,cmd/*/main.go,infra/clickhouse-serverless/cmd/*/main.go}",
  (files) =>
    files.map((file) => {
      const root = dirname(file);
      return [file, { projects: { [root]: file === "go.mod" ? goModule : binary(root) } }];
    }),
];
