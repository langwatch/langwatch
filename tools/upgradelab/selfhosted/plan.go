// Package selfhosted runs a self-hosted upgrade the way an operator does (plan upgrade-soak-rounds
// section 3 W4, run sheet R5): docker compose from infra/compose.yml or helm on kind from charts/,
// images built from infra/docker/Dockerfile, a snapshot restored into those stores, then the
// commands of docs/self-hosting/upgrade.mdx, each recorded beside the guide's line it performs.
package selfhosted

import (
	"fmt"
	"maps"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
)

// Config is one run: which install path, which variant, the two trees and the snapshot entry.
type Config struct {
	Path       string // compose | helm
	Deployment string // a cell.Profiles key: self-hosted, self-hosted-free, self-hosted-free-no-admin
	MainTree   string // a checkout at origin/main: its image, compose file and chart install the old release
	HeadTree   string // the branch checkout: its image, compose file and chart are the upgrade
	Snapshot   string // a produce entry (holds snapshot/)
	RunDir     string
	Upgradelab string // the built upgradelab binary, for snapshot restore
}

// Step is one command. Doc is the guide's line it performs, verbatim, empty for a harness step;
// Deviation says why the command differs from that line.
type Step struct {
	Phase      string // build, stores, restore, main, publish, upgrade, settle
	Doc        string
	Deviation  string
	Argv       []string
	Dir        string
	Background bool // a port-forward: started, left running, stopped when the run ends
}

const (
	registry   = "localhost:5001"
	composeDB  = "upgradelab_compose"
	helmDB     = "upgradelab_helm"
	helmNS     = "langwatch"
	kindName   = "upgradelab"
	readyTries = "360" // 5 s apart: 30 min, the guide's large-installation bound
)

// Origin is the public address of the app for the path.
func Origin(path string) string {
	if path == "helm" {
		return "http://localhost:30560" // charts/lib/kind-config.yaml maps the NodePort
	}
	return "http://localhost:15560"
}

func sh(script string) []string { return []string{"sh", "-c", script} }

func waitReady(phase, url string) Step {
	return Step{Phase: phase, Argv: []string{"curl", "-fsS", "-o", "/dev/null", "--retry", readyTries, "--retry-delay", "5", "--retry-all-errors", url}}
}

func build(tree, tag string) Step {
	return Step{Phase: "build", Dir: tree, Argv: []string{"docker", "build", "-f", "infra/docker/Dockerfile", "-t", tag, "."}}
}

// ComposePlan installs main from its compose file on restored stores, then upgrades by the guide.
// The images go through a local registry, so the guide's `docker compose pull` runs as written.
func ComposePlan(config Config) []Step {
	project := filepath.Join(config.RunDir, "compose")
	image := registry + "/langwatch/langwatch"
	publish := func(phase, tag string) Step {
		return Step{Phase: phase, Argv: sh(fmt.Sprintf("docker tag %[1]s:%[2]s %[1]s:latest && docker push %[1]s:latest", image, tag))}
	}
	compose := func(phase, doc string, args ...string) Step {
		return Step{Phase: phase, Doc: doc, Dir: project, Argv: append([]string{"docker", "compose"}, args...)}
	}
	return []Step{
		{Phase: "build", Argv: sh("docker start upgradelab-registry 2>/dev/null || docker run -d --name upgradelab-registry -p 5001:5000 registry:2")},
		build(config.MainTree, image+":upgradelab-main"),
		build(config.HeadTree, image+":upgradelab-head"),
		publish("build", "upgradelab-main"),
		{Phase: "stores", Argv: []string{"cp", filepath.Join(config.MainTree, "infra", "compose.yml"), filepath.Join(project, "compose.yml")}},
		compose("stores", "", "up", "-d", "--wait", "postgres", "redis", "clickhouse"),
		createDatabase("stores", "http://default:langwatch@127.0.0.1:18123/", composeDB),
		restore(config, [3]string{"postgresql://prisma:prisma@127.0.0.1:15432/" + composeDB + "?schema=mydb",
			"http://default:langwatch@127.0.0.1:18123/" + composeDB, "redis://127.0.0.1:16379/0"}),
		compose("main", "", "up", "-d"),
		waitReady("main", Origin("compose")+"/readyz"),
		publish("publish", "upgradelab-head"),
		{Phase: "upgrade", Doc: "if your compose file predates this, copy the current one from infra/compose.yml",
			Argv: []string{"cp", filepath.Join(config.HeadTree, "infra", "compose.yml"), filepath.Join(project, "compose.yml")}},
		compose("upgrade", "docker compose pull", "pull"),
		compose("upgrade", "docker compose up -d", "up", "-d"),
		waitReady("settle", Origin("compose")+"/readyz"),
	}
}

// HelmPlan installs main's chart on kind on restored stores, then upgrades to the branch's chart by the guide.
func HelmPlan(config Config) []Step {
	project := filepath.Join(config.RunDir, "helm")
	values := filepath.Join(project, "values-production.yaml")
	image := "langwatch/langwatch"
	chart := func(tree string) string { return filepath.Join(tree, "charts", "langwatch") }
	helm := func(phase, verb, tree, tag string, extra ...string) Step {
		argv := []string{"helm", verb, "langwatch", chart(tree), "--namespace", helmNS, "-f", values, "--set", "images.app.tag=" + tag}
		return Step{Phase: phase, Argv: append(argv, extra...)}
	}
	forward := func(service, ports string) Step {
		return Step{Phase: "restore", Background: true, Argv: []string{"kubectl", "--context", "kind-" + kindName, "-n", helmNS, "port-forward", "svc/" + service, ports}}
	}
	upgrade := helm("upgrade", "upgrade", config.HeadTree, "upgradelab-head", "--wait", "--timeout", "45m")
	upgrade.Doc = "helm upgrade langwatch langwatch/langwatch --namespace langwatch -f values-production.yaml --wait --timeout 45m"
	upgrade.Deviation = "chart read from the branch tree, not the published repo; images.app.tag set, as the branch chart's default tag is still the last release"
	return []Step{
		build(config.MainTree, image+":upgradelab-main"),
		build(config.HeadTree, image+":upgradelab-head"),
		{Phase: "stores", Argv: []string{"kind", "create", "cluster", "--name", kindName, "--config", filepath.Join(config.HeadTree, "charts", "lib", "kind-config.yaml")}},
		{Phase: "stores", Argv: []string{"kind", "load", "docker-image", image + ":upgradelab-main", image + ":upgradelab-head", "--name", kindName}},
		// The chart pins its ClickHouse database to "langwatch", which restore refuses (D7): an external ClickHouse on kind's network.
		{Phase: "stores", Argv: []string{"docker", "run", "-d", "--name", "upgradelab-helm-clickhouse", "--network", "kind", "-p", "18124:8123", "-e", "CLICKHOUSE_PASSWORD=langwatch", "langwatch/clickhouse-serverless:0.2.0"}},
		waitReady("stores", "http://127.0.0.1:18124/ping"),
		createDatabase("stores", "http://default:langwatch@127.0.0.1:18124/", helmDB),
		helm("stores", "install", config.MainTree, "upgradelab-main", "--create-namespace", "--set", "app.replicaCount=0", "--set", "workers.replicaCount=0",
			"--set", "app.migrations.preRoll=false", "--kube-context", "kind-"+kindName, "--wait", "--timeout", "15m"),
		forward("langwatch-postgresql", "15433:5432"),
		forward("langwatch-redis-master", "16380:6379"),
		restore(config, [3]string{"postgresql://postgres:upgradelab@127.0.0.1:15433/" + helmDB + "?schema=public",
			"http://default:langwatch@127.0.0.1:18124/" + helmDB, "redis://:upgradelab@127.0.0.1:16380/0"}),
		helm("main", "upgrade", config.MainTree, "upgradelab-main", "--kube-context", "kind-"+kindName, "--wait", "--timeout", "45m"),
		waitReady("main", Origin("helm")+"/readyz"),
		{Phase: "upgrade", Doc: "helm repo update", Deviation: "not run: no published repo holds the branch chart"},
		upgrade,
		waitReady("settle", Origin("helm")+"/readyz"),
	}
}

func createDatabase(phase, server, name string) Step {
	return Step{Phase: phase, Argv: []string{"curl", "-fsS", "--data-binary", "CREATE DATABASE IF NOT EXISTS " + name, server}}
}

// restore takes the Postgres, ClickHouse and Redis URLs, in that order.
func restore(config Config, urls [3]string) Step {
	return Step{Phase: "restore", Argv: []string{config.Upgradelab, "snapshot", "restore", "-from", filepath.Join(config.Snapshot, "snapshot"),
		"-postgres", urls[0], "-clickhouse", "shared=" + urls[1], "-redis", urls[2]}}
}

// ComposeOverride is compose.override.yml, which compose merges by itself: images from the local
// registry, upgradelab_* databases (restore refuses any other name) and ports clear of a dev stack.
func ComposeOverride() string {
	database := "postgresql://prisma:prisma@postgres:5432/" + composeDB + "?schema=mydb"
	clickhouse := "http://default:langwatch@clickhouse:8123/" + composeDB
	release := fmt.Sprintf(`    image: %s/langwatch/langwatch:latest
    environment:
      DATABASE_URL: %s
      CLICKHOUSE_URL: %s
`, registry, database, clickhouse)
	return "services:\n  app:\n" + release + "    ports: !override [\"15560:5560\"]\n  workers:\n" + release +
		"  langevals:\n    ports: !reset []\n" +
		"  postgres:\n    environment:\n      POSTGRES_DB: " + composeDB + "\n    healthcheck:\n      test: [\"CMD-SHELL\", \"pg_isready -U prisma -d " + composeDB + "\"]\n    ports: !override [\"15432:5432\"]\n" +
		"  redis:\n    ports: [\"16379:6379\"]\n" +
		"  clickhouse:\n    ports: !override [\"18123:8123\"]\n"
}

// DotEnv is the operator's .env: one KEY=value line per variable, sorted.
func DotEnv(env map[string]string) string {
	var text strings.Builder
	for _, key := range slices.Sorted(maps.Keys(env)) {
		fmt.Fprintf(&text, "%s=%s\n", key, env[key])
	}
	return text.String()
}

// HelmValues is the operator's values-production.yaml for kind: values-local's sizes, the stores
// restore can reach, and the shape's environment on the app and the workers.
func HelmValues(env map[string]string) string {
	var extra strings.Builder
	for _, key := range slices.Sorted(maps.Keys(env)) {
		fmt.Fprintf(&extra, "    - { name: %s, value: %s }\n", key, strconv.Quote(env[key]))
	}
	return `autogen:
  enabled: true
images:
  app: { repository: langwatch/langwatch, pullPolicy: Never }
app:
  replicaCount: 1
  service: { type: NodePort, port: 5560, nodePort: 30560 }
  http: { baseHost: "` + Origin("helm") + `", publicUrl: "` + Origin("helm") + `" }
  extraEnvs:
` + extra.String() + `workers:
  enabled: true
  replicaCount: 1
  extraEnvs:
` + extra.String() + `clickhouse:
  chartManaged: false
  external:
    url:
      value: "http://default:langwatch@upgradelab-helm-clickhouse:8123/` + helmDB + `"
postgresql:
  chartManaged: true
  auth: { database: ` + helmDB + `, password: upgradelab }
redis:
  chartManaged: true
  auth: { password: upgradelab }
prometheus: { chartManaged: false }
cronjobs: { enabled: false }
`
}
