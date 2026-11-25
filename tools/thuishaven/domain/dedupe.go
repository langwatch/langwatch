package domain

import (
	"cmp"
	"fmt"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
)

// The duplicate-infra sweep: the same server kind (Redis, ClickHouse, an
// observability component) running more than once on the machine. Haven keeps
// the instance its config or a registered stack points at, stops a copy only
// when nobody owns it any more, and reports the rest. Decisions here are pure.

// DuplicateClass is the reap Kind of every duplicate the sweep stops.
const DuplicateClass = "duplicate"

// InfraKind is one shared server kind haven provisions.
type InfraKind string

// The kinds the sweep recognises, by binary or image.
const (
	InfraClickHouse InfraKind = "clickhouse"
	InfraRedis      InfraKind = "redis"
	InfraPostgres   InfraKind = "postgres"
	InfraTempo      InfraKind = "tempo"
	InfraPrometheus InfraKind = "prometheus"
	InfraGrafana    InfraKind = "grafana"
	InfraLoki       InfraKind = "loki"
	InfraPyroscope  InfraKind = "pyroscope"
	InfraCollector  InfraKind = "otel collector"
)

// InfraKinds is the report order.
var InfraKinds = []InfraKind{InfraClickHouse, InfraPostgres, InfraRedis, InfraCollector, InfraTempo, InfraPrometheus, InfraLoki, InfraGrafana, InfraPyroscope}

// DuplicateMode is what the sweep may do: nothing, report, or stop strays.
type DuplicateMode string

// The three modes HAVEN_DEDUPE selects.
const (
	DuplicatesOff    DuplicateMode = "off"
	DuplicatesReport DuplicateMode = "report"
	DuplicatesStop   DuplicateMode = "stop"
)

// DuplicateLimits configure the sweep. The zero value is off.
type DuplicateLimits struct {
	Mode      DuplicateMode
	Every     time.Duration // sweep cadence
	MinAge    time.Duration // a copy younger than this may still be starting up
	KillGrace time.Duration // SIGTERM to SIGKILL
}

// DefaultDuplicateLimits stop strays once a minute after a five-minute grace.
func DefaultDuplicateLimits() DuplicateLimits {
	return DuplicateLimits{Mode: DuplicatesStop, Every: time.Minute, MinAge: 5 * time.Minute, KillGrace: 30 * time.Second}
}

// Enabled reports whether the sweep runs at all.
func (l DuplicateLimits) Enabled() bool {
	return (l.Mode == DuplicatesReport || l.Mode == DuplicatesStop) && l.Every > 0
}

// ParseDuplicateMode reads HAVEN_DEDUPE: 0/off/false, report, or (anything
// else, including unset) stop.
func ParseDuplicateMode(v string) DuplicateMode {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "0", "off", "false", "no":
		return DuplicatesOff
	case "report", "warn":
		return DuplicatesReport
	}
	return DuplicatesStop
}

// InfraKindOfCommand classifies a host process by its binary; false when it is
// not a server kind the sweep knows. Clients (redis-cli, psql) never match.
func InfraKindOfCommand(command string) (InfraKind, bool) {
	fields := strings.Fields(command)
	if len(fields) == 0 {
		return "", false
	}
	second := ""
	if len(fields) > 1 {
		second = fields[1]
	}
	switch filepath.Base(fields[0]) {
	case "redis-server", "valkey-server":
		return InfraRedis, true
	case "postgres", "postmaster":
		return InfraPostgres, true
	case "clickhouse-server":
		return InfraClickHouse, true
	case "clickhouse":
		return InfraClickHouse, second == "server"
	case "tempo":
		return InfraTempo, true
	case "prometheus":
		return InfraPrometheus, true
	case "loki":
		return InfraLoki, true
	case "pyroscope":
		return InfraPyroscope, true
	case "alloy", "otelcol", "otelcol-contrib", "otel-collector":
		return InfraCollector, true
	case "grafana-server":
		return InfraGrafana, true
	case "grafana":
		return InfraGrafana, second == "server"
	}
	return "", false
}

// InfraKindsOfImage classifies a container image; the LGTM bundle is every
// observability kind at once.
func InfraKindsOfImage(image string) []InfraKind {
	repo := strings.ToLower(image)
	if at := strings.Index(repo, "@"); at >= 0 {
		repo = repo[:at]
	}
	if colon := strings.LastIndex(repo, ":"); colon > strings.LastIndex(repo, "/") {
		repo = repo[:colon]
	}
	base := repo[strings.LastIndex(repo, "/")+1:]
	switch {
	case base == "otel-lgtm":
		return []InfraKind{InfraCollector, InfraTempo, InfraPrometheus, InfraLoki, InfraGrafana}
	case strings.Contains(base, "clickhouse"):
		return []InfraKind{InfraClickHouse}
	case base == "redis" || base == "redis-stack-server" || base == "valkey":
		return []InfraKind{InfraRedis}
	case base == "postgres" || base == "postgis" || base == "pgvector":
		return []InfraKind{InfraPostgres}
	case base == "tempo":
		return []InfraKind{InfraTempo}
	case base == "prometheus":
		return []InfraKind{InfraPrometheus}
	case base == "loki":
		return []InfraKind{InfraLoki}
	case base == "grafana" || base == "grafana-oss":
		return []InfraKind{InfraGrafana}
	case base == "pyroscope":
		return []InfraKind{InfraPyroscope}
	case base == "alloy" || strings.Contains(base, "otel-collector") || strings.Contains(base, "opentelemetry-collector") || strings.HasPrefix(base, "otelcol"):
		return []InfraKind{InfraCollector}
	}
	return nil
}

// CommandPort is the port a server's argv names (`*:53114`, `--port 6380`,
// `-p 5433`, `--web.listen-address=127.0.0.1:9090`), or 0.
func CommandPort(command string) int {
	fields := strings.Fields(command)
	for i, f := range fields {
		if (f == "--port" || f == "-p") && i+1 < len(fields) {
			if p, ok := portNumber(fields[i+1]); ok {
				return p
			}
		}
		if p, ok := addressPort(f); ok {
			return p
		}
	}
	return 0
}

// addressPort reads `host:port`, `*:port` or `--flag=host:port`; never a path or URL.
func addressPort(word string) (int, bool) {
	if flag, value, isFlag := strings.Cut(word, "="); isFlag && strings.HasPrefix(word, "-") {
		if flag == "--port" {
			return portNumber(value)
		}
		word = value
	}
	colon := strings.LastIndex(word, ":")
	if colon < 0 || strings.Contains(word, "/") {
		return 0, false
	}
	return portNumber(word[colon+1:])
}

func portNumber(s string) (int, bool) {
	p, err := strconv.Atoi(s)
	return p, err == nil && p > 0 && p < 65536
}

var publishedPortPattern = regexp.MustCompile(`:(\d+)->`)

// PublishedPorts reads the host ports out of `docker ps {{.Ports}}`.
func PublishedPorts(ports string) []int {
	var out []int
	for _, m := range publishedPortPattern.FindAllStringSubmatch(ports, -1) {
		if p, err := strconv.Atoi(m[1]); err == nil && !slices.Contains(out, p) {
			out = append(out, p)
		}
	}
	return out
}

// InfraContainer is one running container from the runtime's listing.
type InfraContainer struct {
	ID     string
	Name   string
	Image  string
	Ports  []int
	Labels map[string]string
}

// ComposeWorkingDirLabel is where compose records the project directory.
const ComposeWorkingDirLabel = "com.docker.compose.project.working_dir"

// ParseInfraContainerListing parses "ID\tNames\tImage\tPorts\tLabels" lines.
func ParseInfraContainerListing(out string) []InfraContainer {
	var cs []InfraContainer
	for line := range strings.SplitSeq(out, "\n") {
		parts := strings.SplitN(line, "\t", 5)
		if len(parts) != 5 || parts[0] == "" {
			continue
		}
		labels := map[string]string{}
		for kv := range strings.SplitSeq(parts[4], ",") {
			if k, v, ok := strings.Cut(kv, "="); ok {
				labels[k] = v
			}
		}
		cs = append(cs, InfraContainer{ID: parts[0], Name: parts[1], Image: parts[2], Ports: PublishedPorts(parts[3]), Labels: labels})
	}
	return cs
}

// InfraInstance is one running copy of a kind: a process tree's root, or a
// container. The app fills the facts; JudgeDuplicates decides.
type InfraInstance struct {
	Kind        InfraKind
	PID         int // 0 for a container
	Container   string
	ContainerID string
	Port        int
	Origin      string // brew, haven, testcontainers, compose, a container name
	Referenced  bool   // config or a registered stack points at it
	Protected   bool   // inside the daemon's or a registered stack's tree
	OwnerAlive  bool   // its parent (or owning tool) still runs
	Owner       string // who, when alive
	InScope     bool   // dev tooling: under the repo, a worktree or haven home; or haven's container
	OldEnough   bool
	Elapsed     time.Duration
}

// Label names the instance for logs and status: "brew :6379", "pid 9 :53114".
func (i InfraInstance) Label() string {
	who := fmt.Sprintf("pid %d", i.PID)
	if i.Container != "" {
		who = "container " + i.Container
	} else if i.Origin == "brew" || i.Origin == "haven" {
		who = fmt.Sprintf("%s pid %d", i.Origin, i.PID)
	}
	if i.Port > 0 {
		who += fmt.Sprintf(" :%d", i.Port)
	}
	return who
}

// Verdict is what the sweep does with one instance.
type Verdict string

// The three verdicts: canonical, reported, stopped.
const (
	VerdictKept Verdict = "kept"
	VerdictLeft Verdict = "left"
	VerdictStop Verdict = "stop"
)

// JudgedInstance is an instance with its verdict and the reason for it.
type JudgedInstance struct {
	InfraInstance
	Verdict Verdict
	Why     string
}

// DuplicateGroup is one kind running more than once.
type DuplicateGroup struct {
	Kind      InfraKind
	Canonical bool // at least one copy is the one haven points at
	Instances []JudgedInstance
}

// JudgeDuplicates groups instances by kind and keeps only kinds that run more
// than once. A copy is stopped only when a canonical one exists and the copy
// is unreferenced, unprotected, ownerless, in scope and past MinAge.
func JudgeDuplicates(instances []InfraInstance) []DuplicateGroup {
	byKind := map[InfraKind][]InfraInstance{}
	for n := range instances {
		byKind[instances[n].Kind] = append(byKind[instances[n].Kind], instances[n])
	}
	var groups []DuplicateGroup
	for _, kind := range InfraKinds {
		list := byKind[kind]
		if len(list) < 2 {
			continue
		}
		// The app collects instances from maps, so the order is fixed here: the
		// copy haven points at first, then by pid and container.
		slices.SortStableFunc(list, func(a, b InfraInstance) int {
			if a.Referenced != b.Referenced {
				if a.Referenced {
					return -1
				}
				return 1
			}
			if a.PID != b.PID {
				return cmp.Compare(a.PID, b.PID)
			}
			return cmp.Compare(a.ContainerID, b.ContainerID)
		})
		g := DuplicateGroup{Kind: kind}
		for n := range list {
			g.Canonical = g.Canonical || list[n].Referenced
		}
		for n := range list {
			g.Instances = append(g.Instances, judge(list[n], g.Canonical))
		}
		groups = append(groups, g)
	}
	return groups
}

func judge(i InfraInstance, canonical bool) JudgedInstance {
	j := JudgedInstance{InfraInstance: i, Verdict: VerdictLeft}
	switch {
	case i.Referenced:
		j.Verdict, j.Why = VerdictKept, "kept"
	case !canonical:
		j.Why = "left: no copy is the one haven points at"
	case i.Protected:
		j.Why = "left: inside a running stack or the daemon"
	case i.OwnerAlive:
		j.Why = "owned by " + i.Owner + ", left"
	case !i.InScope:
		j.Why = "left: not haven's or this checkout's"
	case !i.OldEnough:
		j.Why = "left: still starting"
	default:
		j.Verdict, j.Why = VerdictStop, "stray: its owner is gone"
	}
	return j
}

// Kept is the group's canonical copies, for a reason naming both instances.
func (g DuplicateGroup) Kept() []string {
	var out []string
	for n := range g.Instances {
		if g.Instances[n].Verdict == VerdictKept {
			out = append(out, g.Instances[n].Label())
		}
	}
	return out
}

// Describe is the one status line: "2 redis running: brew pid 1 :6379 (kept),
// pid 9 :53114 (owned by upgradelab cell (pid 8), left)".
func (g DuplicateGroup) Describe() string {
	parts := make([]string, len(g.Instances))
	for n := range g.Instances {
		parts[n] = fmt.Sprintf("%s (%s)", g.Instances[n].Label(), g.Instances[n].Why)
	}
	return fmt.Sprintf("%d %s running: %s", len(g.Instances), g.Kind, strings.Join(parts, ", "))
}

// ProcessOrigin names where a server binary came from, for the report.
func ProcessOrigin(command, havenHome string) string {
	bin := strings.Fields(command)
	if len(bin) == 0 {
		return ""
	}
	switch {
	case havenHome != "" && UnderRoots(bin[0], []string{havenHome}):
		return "haven"
	case strings.Contains(bin[0], "/homebrew/") || strings.Contains(bin[0], "/Cellar/") || strings.HasPrefix(bin[0], "/usr/local/opt/"):
		return "brew"
	}
	return ""
}

// HavenContainer reports whether name is one of haven's own singletons.
func HavenContainer(name string) bool {
	return name == ClickHouseContainer || name == ObservabilityContainer
}
