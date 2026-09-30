import { basename, dirname } from "node:path";

// The root Go module is project `go` (test:go, lint:go), rooted at pkg/ so it never
// owns root files; each main package under cmd/ is a project whose `build` writes
// .bin/<name>/<name>. Affected follows the `go` named input each target hashes, so
// any Go change marks them all. targetDefaults in nx.json; ADR-150 records why.
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
    implicitDependencies: consoles[name] ?? [],
    targets: { build },
  };
};

export const createNodes = [
  "{go.mod,cmd/*/main.go,infra/clickhouse-serverless/cmd/*/main.go}",
  (files) =>
    files.map((file) => {
      if (file === "go.mod") return [file, { projects: { pkg: goModule } }];
      const root = dirname(file);
      return [file, { projects: { [root]: binary(root) } }];
    }),
];
