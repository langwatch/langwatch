package visualdiff

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Layout is the shape of a checkout. The two refs a visual diff compares are
// frequently on either side of the extraction, so the tool detects each one
// rather than assuming.
type Layout string

const (
	// LayoutModular is apps/ui + apps/api + apps/worker.
	LayoutModular Layout = "modular"
	// LayoutMonolith is the platform/app application.
	LayoutMonolith Layout = "monolith"
)

// DetectLayout reports which layout a checkout has.
func DetectLayout(dir string) (Layout, error) {
	if _, err := os.Stat(filepath.Join(dir, "apps", "api", "package.json")); err == nil {
		return LayoutModular, nil
	}
	if _, err := os.Stat(filepath.Join(dir, "platform", "app", "package.json")); err == nil {
		return LayoutMonolith, nil
	}
	return "", fmt.Errorf("%s: neither apps/api nor platform/app — not a LangWatch checkout", dir)
}

// Ports is one stack's port allocation. The layout follows the repository's
// own derivation from PORT (dev/docs/adr/004-docker-dev-environment.md): the
// browser lane binds PORT, the API lane PORT+1000, the worker's
// metrics/healthz listener PORT-2561.
type Ports struct {
	UI     int
	API    int
	Worker int
}

// PortsFor derives one stack's ports from its base port.
func PortsFor(basePort int) Ports {
	return Ports{UI: basePort, API: basePort + 1000, Worker: basePort - 2561}
}

// All lists the ports in a stable order, which is also the order teardown
// frees them in.
func (ports Ports) All() []int { return []int{ports.UI, ports.API, ports.Worker} }

// Stack is one booted ref.
type Stack struct {
	Name         string // "base" or "candidate"
	Ref          string
	Dir          string
	BasePort     int
	Ports        Ports
	Layout       Layout
	RedisDBIndex string
	// HavenSlug is the haven stack this ref runs as, set once the plan
	// decides to boot through haven. Empty on the port-based path.
	HavenSlug string
	// HavenURL is the app hostname haven allocated for this stack, adopted
	// once its ui and backend lanes are reported listening. Empty until then
	// and always empty on the port-based path.
	HavenURL string
}

// URL is the origin the runner drives: the routed app hostname on the haven
// path, since that is where the browser actually renders the screens; on the
// port-based path, the UI and its API share one origin in the modular
// layout, and the monolith serves both from the same port too.
func (stack Stack) URL() string {
	if stack.HavenURL != "" {
		return stack.HavenURL
	}
	return "http://localhost:" + strconv.Itoa(stack.Ports.UI)
}

// APIURL is the origin the seeder posts fixtures to. haven serves the API
// under /api on the same routed origin as the UI, so it is the same address
// as URL() there.
func (stack Stack) APIURL() string {
	if stack.HavenURL != "" {
		return stack.HavenURL
	}
	return "http://localhost:" + strconv.Itoa(stack.Ports.API)
}

// Plan is everything a run decided before it started anything.
type Plan struct {
	Base       Stack
	Candidate  Stack
	Viewport   Viewport
	RunDir     string
	RoutesOnly bool
	RouteCount int
	FlowIDs    []string
	// UseHaven and RunID are set once the plan decides to boot through haven;
	// RunID is what both stacks' haven slugs are derived from (see haven.go).
	UseHaven bool
	RunID    string
}

// DefaultBasePort is where the base stack starts. The candidate stack sits
// PortStride above it, so neither stack can land on a port the other uses.
const (
	DefaultBasePort = 5670
	PortStride      = 10
)

// Refs names the two revisions a run compares.
type Refs struct {
	Base      string
	Candidate string
}

// PendingRedisDBIndex is what a stack's RedisDBIndex reads as before the run
// has allocated real ones - the dry-run preview never opens a Redis
// connection, so it has nothing else to show. Execute overwrites both
// stacks' RedisDBIndex with the outcome of AllocateRedisDBs before it boots
// anything for real.
const PendingRedisDBIndex = "auto"

// PlanStacks allocates both stacks. The stride keeps every port distinct: no
// derived port of one stack can equal a derived port of the other, because
// the derivations are the same affine functions of two base ports that differ
// by less than any gap between them.
func PlanStacks(basePort int, refs Refs, runDir string) (Stack, Stack) {
	base := Stack{
		Name:         "base",
		Ref:          refs.Base,
		Dir:          filepath.Join(runDir, "base"),
		BasePort:     basePort,
		Ports:        PortsFor(basePort),
		RedisDBIndex: PendingRedisDBIndex,
	}
	candidate := Stack{
		Name:         "candidate",
		Ref:          refs.Candidate,
		Dir:          filepath.Join(runDir, "candidate"),
		BasePort:     basePort + PortStride,
		Ports:        PortsFor(basePort + PortStride),
		RedisDBIndex: PendingRedisDBIndex,
	}
	return base, candidate
}

// AllPorts lists every port the plan will bind, base stack first.
func (plan Plan) AllPorts() []int {
	return append(plan.Base.Ports.All(), plan.Candidate.Ports.All()...)
}

// managedEnvKeys are dropped from the inherited environment before the
// stack's own values are appended, so an operator's shell can never decide
// which port or which database a stack uses.
var managedEnvKeys = []string{
	"PORT", "APP_PORT", "API_PORT", "LANGWATCH_API_PORT", "WORKER_PORT",
	"BASE_HOST", "NEXTAUTH_URL", "REDIS_DB_INDEX",
	"SKIP_PRISMA_MIGRATE", "SKIP_CLICKHOUSE_MIGRATE", "SKIP_LWQL_PROVISION",
	"LANGWATCH_SKIP_AIGATEWAY", "LANGWATCH_SKIP_NLP", "LANGWATCH_SKIP_LANGY",
}

// Env composes one stack's process environment. The two stacks share the
// developer's Postgres and ClickHouse — a visual diff compares rendering, so
// both sides must read the same rows — which is exactly why the migration and
// provisioning steps are skipped on a monolith-layout ref: it would otherwise
// re-apply its own older migration set over the shared schema on boot.
func (stack Stack) Env(inherit []string) []string {
	managed := map[string]bool{}
	for _, key := range managedEnvKeys {
		managed[key] = true
	}
	env := make([]string, 0, len(inherit)+12)
	for _, entry := range inherit {
		name, _, _ := strings.Cut(entry, "=")
		if managed[name] {
			continue
		}
		env = append(env, entry)
	}
	origin := stack.URL()
	env = append(env,
		"PORT="+strconv.Itoa(stack.BasePort),
		"APP_PORT="+strconv.Itoa(stack.Ports.UI),
		"API_PORT="+strconv.Itoa(stack.Ports.API),
		"BASE_HOST="+origin,
		"NEXTAUTH_URL="+origin,
		"REDIS_DB_INDEX="+stack.RedisDBIndex,
		"LANGWATCH_SKIP_AIGATEWAY=1",
		"LANGWATCH_SKIP_NLP=1",
		"LANGWATCH_SKIP_LANGY=1",
	)
	if stack.Layout == LayoutMonolith {
		env = append(env,
			"SKIP_PRISMA_MIGRATE=true",
			"SKIP_CLICKHOUSE_MIGRATE=true",
			"SKIP_LWQL_PROVISION=true",
			"LANGWATCH_API_PORT="+strconv.Itoa(stack.Ports.UI),
		)
	}
	return env
}

// StartCommands are the pnpm scripts that bring one stack up. The modular
// layout runs three processes, always: a stack missing the worker serves
// pages and quietly processes no jobs. The monolith serves everything from
// one process.
func (stack Stack) StartCommands() [][]string {
	if stack.Layout == LayoutMonolith {
		return [][]string{{"dev:app"}}
	}
	return [][]string{{"dev:ui"}, {"dev:api"}, {"dev:worker"}}
}

// ReadinessURLs are the listeners a run waits for before it captures.
func (stack Stack) ReadinessURLs() []string {
	if stack.Layout == LayoutMonolith {
		return []string{stack.URL() + HealthPath}
	}
	return []string{stack.URL(), stack.APIURL() + HealthPath}
}

// HealthPath is the API's health endpoint on both layouts.
const HealthPath = "/api/health"
