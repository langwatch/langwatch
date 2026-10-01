import { basename, dirname } from "node:path";

// One project per charts/*/Chart.yaml; the umbrella depends on the leaf charts it
// bundles through file:// (its `helm dependency build` packages them). Flags follow
// langwatch-chart.yml and prerelease-charts-oci.yml; ADR-150 records why.
const umbrella = "langwatch";
const repos = {
  "prometheus-community": "https://prometheus-community.github.io/helm-charts",
  langwatch: "https://langwatch.github.io/langwatch",
};

const needHelm =
  'command -v helm >/dev/null || { echo "helm is not installed: install it (brew install helm) to run chart targets" >&2; exit 1; }';
const helm = { runtime: "helm version --short" };
const source = ["{projectRoot}/**/*", "!{projectRoot}/charts/**/*", helm];

const run = (root, ...steps) => ({
  executor: "nx:run-commands",
  options: { cwd: root, command: [needHelm, ...steps].join(" && ") },
});

const chart = (root) => {
  const dir = basename(root);
  const isUmbrella = dir === umbrella;
  const addRepos = isUmbrella
    ? Object.entries(repos).map(([name, url]) => `helm repo add ${name} ${url} --force-update`)
    : [];
  const leaves = isUmbrella
    ? ["{workspaceRoot}/charts/{clickhouse-serverless,gateway,langyagent}/**/*"]
    : [];
  const bundled = { dependentTasksOutputFiles: "**/*" };
  return {
    name: `chart-${dir}`,
    tags: ["helm"],
    implicitDependencies: isUmbrella
      ? ["chart-clickhouse-serverless", "chart-gateway", "chart-langyagent"]
      : [],
    targets: {
      "helm:deps": {
        ...run(root, ...addRepos, "helm dependency build ."),
        cache: true,
        dependsOn: ["^helm:deps"],
        inputs: [...source, ...leaves],
        outputs: ["{projectRoot}/charts"],
      },
      "helm:lint": {
        ...run(root, "helm lint ."),
        cache: true,
        dependsOn: ["helm:deps"],
        inputs: [...source, bundled],
        outputs: [],
      },
      "helm:template": {
        ...run(root, "helm template smoke . --set autogen.enabled=true >/dev/null"),
        cache: true,
        dependsOn: ["helm:deps"],
        inputs: [...source, bundled],
        outputs: [],
      },
    },
  };
};

export const createNodes = [
  "charts/*/Chart.yaml",
  (files) => files.map((file) => [file, { projects: { [dirname(file)]: chart(dirname(file)) } }]),
];
