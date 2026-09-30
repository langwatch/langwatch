package diffsuite

import (
	"bufio"
	"cmp"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
)

// otherArea holds what no area's families name.
const otherArea = "Other"

// areaFamilies maps each product area to the route families it covers: the first path
// segment after /api, past v1, latest and a dated version.
var areaFamilies = map[string][]string{
	"Agent testing":                   {"agents", "scenarios", "scenario-events", "suites", "test-suites", "simulation-runs", "run-plans", "agent-cache", "elevenlabs", "voice"},
	"AI gateway":                      {"gateway"},
	"Analytics and LangWatchQL":       {"query", "analytics", "dashboards", "graphs"},
	"Automations and webhooks":        {"webhooks", "triggers", "trigger"},
	"Coding agents":                   {"coding-agent", "github", "github-langy"},
	"Datasets":                        {"dataset"},
	"Evaluations and monitors":        {"evaluators", "monitors", "evaluations", "guardrails"},
	"Experiments and optimisation":    {"experiments", "experiment", "optimization"},
	"Files and media":                 {"files", "stored-objects", "user-avatar", "image-proxy"},
	"Governance and Connect":          {"governance", "connect"},
	"Instant evals":                   {"instant-evals"},
	"Langy":                           {"langy", "copilotkit"},
	"Model providers and secrets":     {"model-providers", "model-defaults", "secrets"},
	"Ops, admin and health":           {"admin", "ops", "health", "internal", "bug-reports", "checkup", "unsubscribe"},
	"Organisations, teams and access": {"organization", "organizations", "teams", "groups", "roles", "role-bindings", "api-keys", "projects", "me", "onboarding"},
	"Prompts and playground":          {"prompts", "playground"},
	"SCIM":                            {"scim", "scim-tokens"},
	"Sign-in and CLI login":           {"auth"},
	"Tracing and ingestion":           {"trace", "traces", "otel", "collector", "ingest", "annotations", "export", "rum", "events"},
	"Workflows":                       {"workflows"},
}

// flowFileAreas maps each visualdiff flow file (tools/visualdiff/flows/<name>.yaml) to its area.
var flowFileAreas = map[string]string{
	"admin-security": "Organisations, teams and access", "agents": "Agent testing", "annotations": "Tracing and ingestion",
	"auth": "Sign-in and CLI login", "automation-channels": "Automations and webhooks", "coding-assistants": "Coding agents",
	"core": "Tracing and ingestion", "dashboards": "Analytics and LangWatchQL", "datasets": "Datasets",
	"evaluations": "Evaluations and monitors", "gateway": "AI gateway", "instant-evals": "Instant evals", "langy": "Langy",
	"lwql": "Analytics and LangWatchQL", "observability": "Tracing and ingestion", "onboarding": "Organisations, teams and access",
	"prompts": "Prompts and playground", "prompts-automations": "Prompts and playground", "settings-gateway": "AI gateway",
	"simulations": "Agent testing", "webhooks-billing": "Automations and webhooks", "workflows": "Workflows",
}

var familyArea = func() map[string]string {
	areas := map[string]string{}
	for area, families := range areaFamilies {
		for _, family := range families {
			areas[family] = area
		}
	}
	return areas
}()

var (
	datedVersion   = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	scenariosFile  = regexp.MustCompile(`scenarios: (\S+scenarios\.jsonl)`)
	deferredLine   = regexp.MustCompile(`scenarios: (\d+) deferred`)
	flowTally      = regexp.MustCompile(`(\d+)/(\d+) flows passed`)
	routeTally     = regexp.MustCompile(`(\d+)/(\d+) routes without a finding`)
	flowLine       = regexp.MustCompile(`(?m)^(?:\[[0-9:]+\] )?(PASS|VERIFIED|FAIL|UNPROVEN)\s+(\S+)`)
	flowID         = regexp.MustCompile(`(?m)^\s*- id:\s*(\S+)`)
	fuzzDir        = regexp.MustCompile(`fuzz (?:api|ui): wrote (\S+)`)
	fuzzOperations = regexp.MustCompile(`operations exercised: (\d+)/(\d+)`)
	fuzzRequests   = regexp.MustCompile(`(\d+) requests ·`)
)

// results is one suite run as its tools left it under -out, read for publishing.
type results struct {
	at                   time.Time
	commit, branch, main string
	tools                map[string]toolSummary
	api                  apiResults
	visual               visualResults
	fuzzAPI, fuzzUI      fuzzResults
}

type apiResults struct {
	ran                          bool
	pass, fail, errors, deferred int
	areas                        map[string]*tally
}

type visualResults struct {
	ran                      bool
	flowsPass, flowsTotal    int
	routesClean, routesTotal int
	areas                    map[string]*tally
}

type fuzzResults struct {
	ran                       bool
	findings, proxy502, hangs int
	operations, requests      int
	visited, routes           int
}

// tally is one area's scenarios or flows: how many passed of how many, and the failing ids.
type tally struct {
	pass, total int
	failing     []string
}

// suiteSummary is the part of summary.json publishing reads.
type suiteSummary struct {
	StartedAt   string        `json:"startedAt"`
	Commit      string        `json:"commit"`
	BranchStack string        `json:"branchStack"`
	MainStack   string        `json:"mainStack"`
	Tools       []toolSummary `json:"tools"`
}

// readResults reads summary.json and each default tool's log and output. A tool that
// left nothing behind reads as not run.
func readResults(out, root string) (results, error) {
	body, err := os.ReadFile(filepath.Join(out, "summary.json")) // #nosec G304 -- the operator's own suite directory.
	if err != nil {
		return results{}, err
	}
	var summary suiteSummary
	if err := json.Unmarshal(body, &summary); err != nil {
		return results{}, err
	}
	found := results{commit: summary.Commit, branch: summary.BranchStack, main: summary.MainStack, tools: map[string]toolSummary{}}
	found.at, _ = time.Parse(time.RFC3339, summary.StartedAt)
	for _, tool := range summary.Tools {
		found.tools[tool.Name] = tool
	}
	found.api = readAPI(logText(out, "api"), root)
	found.visual = readVisual(logText(out, "visual"), readFlowAreas(root))
	found.fuzzAPI = readFuzz(logText(out, "fuzzapi"))
	found.fuzzUI = readFuzz(logText(out, "fuzzui"))
	return found, nil
}

func logText(out, name string) string {
	body, _ := os.ReadFile(filepath.Join(out, name+".log")) // #nosec G304 -- the operator's own suite directory.
	return string(body)
}

func lastMatch(pattern *regexp.Regexp, text string) []string {
	matches := pattern.FindAllStringSubmatch(text, -1)
	if len(matches) == 0 {
		return nil
	}
	return matches[len(matches)-1]
}

func number(text string) int {
	value, _ := strconv.Atoi(text)
	return value
}

func entry(areas map[string]*tally, area string) *tally {
	if areas[area] == nil {
		areas[area] = &tally{}
	}
	return areas[area]
}

// areaOf is the area of an endpoint such as "GET /api/v1/workflows/{id}".
func areaOf(endpoint string) string {
	path := endpoint
	if _, after, ok := strings.Cut(endpoint, " "); ok {
		path = after
	}
	segments := strings.FieldsFunc(path, func(char rune) bool { return char == '/' })
	if len(segments) > 0 && segments[0] == "api" {
		segments = segments[1:]
	}
	for len(segments) > 0 && (segments[0] == "v1" || segments[0] == "latest" || datedVersion.MatchString(segments[0])) {
		segments = segments[1:]
	}
	if len(segments) == 0 {
		return otherArea
	}
	return cmp.Or(familyArea[segments[0]], otherArea)
}

// readAPI tallies the scenarios.jsonl the api log names, per area.
func readAPI(log, root string) apiResults {
	match := lastMatch(scenariosFile, log)
	if match == nil {
		return apiResults{}
	}
	path := match[1]
	if !filepath.IsAbs(path) {
		path = filepath.Join(root, path)
	}
	file, err := os.Open(path) // #nosec G304 -- the file apidiff said it wrote.
	if err != nil {
		return apiResults{}
	}
	defer file.Close()
	found := apiResults{ran: true, areas: map[string]*tally{}}
	if deferred := lastMatch(deferredLine, log); deferred != nil {
		found.deferred = number(deferred[1])
	}
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 1024*1024), 64*1024*1024)
	for scanner.Scan() {
		var record struct{ ID, Endpoint, Verdict string }
		if json.Unmarshal(scanner.Bytes(), &record) != nil || record.ID == "" {
			continue
		}
		area := entry(found.areas, areaOf(record.Endpoint))
		area.total++
		switch record.Verdict {
		case "PASS":
			found.pass++
			area.pass++
		case "ERROR":
			found.errors++
			area.failing = append(area.failing, record.ID)
		default:
			found.fail++
			area.failing = append(area.failing, record.ID)
		}
	}
	return found
}

// readFlowAreas maps every flow id to the area of the file that declares it.
func readFlowAreas(root string) map[string]string {
	areas := map[string]string{}
	files, _ := filepath.Glob(filepath.Join(root, "tools", "visualdiff", "flows", "*.yaml"))
	for _, file := range files {
		body, err := os.ReadFile(file) // #nosec G304 -- the repository's own flow files.
		if err != nil {
			continue
		}
		area := cmp.Or(flowFileAreas[strings.TrimSuffix(filepath.Base(file), ".yaml")], otherArea)
		for _, match := range flowID.FindAllStringSubmatch(string(body), -1) {
			areas[match[1]] = area
		}
	}
	return areas
}

// readVisual reads visualdiff check's tallies and its last verdict per flow from its log.
func readVisual(log string, flowAreas map[string]string) visualResults {
	found := visualResults{areas: map[string]*tally{}}
	if match := lastMatch(flowTally, log); match != nil {
		found.ran, found.flowsPass, found.flowsTotal = true, number(match[1]), number(match[2])
	}
	if match := lastMatch(routeTally, log); match != nil {
		found.routesClean, found.routesTotal = number(match[1]), number(match[2])
	}
	verdicts := map[string]string{}
	for _, match := range flowLine.FindAllStringSubmatch(log, -1) {
		verdicts[match[2]] = match[1]
	}
	for id, verdict := range verdicts {
		area := entry(found.areas, cmp.Or(flowAreas[id], otherArea))
		area.total++
		if verdict == "PASS" || verdict == "VERIFIED" {
			area.pass++
		} else {
			area.failing = append(area.failing, id)
		}
	}
	for _, area := range found.areas {
		slices.Sort(area.failing)
	}
	return found
}

// readFuzz reads a fuzz run's findings.jsonl from the directory its log says it wrote.
func readFuzz(log string) fuzzResults {
	match := lastMatch(fuzzDir, log)
	if match == nil {
		return fuzzResults{}
	}
	dir := match[1]
	if strings.HasSuffix(dir, ".json") {
		dir = filepath.Dir(dir)
	}
	found := fuzzResults{ran: true}
	if operations := lastMatch(fuzzOperations, log); operations != nil {
		found.operations = number(operations[2])
	}
	if requests := lastMatch(fuzzRequests, log); requests != nil {
		found.requests = number(requests[1])
	}
	file, err := os.Open(filepath.Join(dir, "findings.jsonl")) // #nosec G304 -- the directory fuzz said it wrote.
	if err != nil {
		return found
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 1024*1024), 64*1024*1024)
	for scanner.Scan() {
		var record struct {
			Kind, Oracle                 string
			Status                       int
			Finding                      bool
			RoutesExercised, RoutesTotal int
		}
		if json.Unmarshal(scanner.Bytes(), &record) != nil {
			continue
		}
		switch {
		case record.Kind == "run-complete":
			found.visited, found.routes = record.RoutesExercised, record.RoutesTotal
		case record.Finding:
			found.findings++
			if record.Status == 502 {
				found.proxy502++
			}
			if record.Oracle == "hang" {
				found.hangs++
			}
		}
	}
	return found
}
