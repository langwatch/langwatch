package apidiff

import (
	"bytes"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

// Scenarios are data: one YAML file per area under tools/apidiff/scenarios.
// A scenario is one request plus the checks that prove it did its job on each
// side. The format is frozen by .claude/manifests/apidiff-scenarios.md.

// Scenario auth kinds and shards.
const (
	authProject    = "project"
	authOrg        = "org"
	authAdmin      = "admin"
	authSCIM       = "scim"
	authNone       = "none"
	authRestricted = "restricted"
	authProjectB   = "project-b"
	authProjectC   = "project-c"
	authOrgC       = "org-c"
	authOrgCOrg    = "org-c-org"
	authSession    = "session"
	authCLI        = "cli"

	shardShared  = "shared"
	shardProject = "project"
	shardOrg     = "org"
	shardSerial  = "serial"
)

var scenarioAuths = map[string]bool{
	authProject: true, authOrg: true, authAdmin: true, authSCIM: true, authNone: true,
	authRestricted: true, authProjectB: true, authProjectC: true, authSession: true, authCLI: true,
	authOrgC: true, authOrgCOrg: true,
}

var scenarioShards = map[string]bool{shardShared: true, shardProject: true, shardOrg: true, shardSerial: true}

var (
	scenarioIDPattern   = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)
	scenarioCapturePat  = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)
	scenarioEndpointPat = regexp.MustCompile(`^(GET|POST|PUT|PATCH|DELETE) /\S*$`)
)

// scenario is one named request against one endpoint plus its checks.
type scenario struct {
	ID       string `yaml:"id"`
	Endpoint string `yaml:"endpoint"`
	Auth     string `yaml:"auth"`
	Shard    string `yaml:"shard"`
	Serial   bool   `yaml:"serial"` // run alone after the pool drains, in its own shard kind
	// SelfHosted marks a scenario the SaaS deployment does not serve; it is deferred there.
	SelfHosted bool              `yaml:"selfHosted"`
	Setup      []scenarioStep    `yaml:"setup"`
	Request    scenarioRequest   `yaml:"request"`
	Capture    map[string]string `yaml:"capture"`
	Expect     scenarioExpect    `yaml:"expect"`
	Verify     []scenarioStep    `yaml:"verify"`
	// Teardown are request steps sent last, whatever the steps before them found,
	// to remove what the scenario made on a shared org; their failures are not the scenario's.
	Teardown []scenarioStep `yaml:"teardown"`
	file     string
	order    int
}

// scenarioRequest is a method, a path and what to send. In a step it may be
// the scalar "METHOD /path"; the step's own body, query and headers then apply.
type scenarioRequest struct {
	Method  string
	Path    string
	Body    any
	Query   map[string]any
	Headers map[string]string
	Auth    string
	// BodyRaw is sent as it is (no JSON encoding) with ContentType.
	BodyRaw     *string
	ContentType string
}

type scenarioRequestFields struct {
	Method  string            `yaml:"method"`
	Path    string            `yaml:"path"`
	Body    any               `yaml:"body"`
	Query   map[string]any    `yaml:"query"`
	Headers map[string]string `yaml:"headers"`
	Auth    string            `yaml:"auth"`

	BodyRaw     *string `yaml:"bodyRaw"`
	ContentType string  `yaml:"contentType"`
}

// UnmarshalYAML accepts "METHOD /path" or the mapping form.
func (request *scenarioRequest) UnmarshalYAML(node *yaml.Node) error {
	if node.Kind == yaml.ScalarNode {
		method, path, ok := strings.Cut(strings.TrimSpace(node.Value), " ")
		if !ok || !isScenarioMethod(method) || !isScenarioPath(strings.TrimSpace(path)) {
			return fmt.Errorf("line %d: request %q is not \"METHOD /path\"", node.Line, node.Value)
		}
		request.Method, request.Path = method, strings.TrimSpace(path)
		return nil
	}
	if err := rejectUnknownKeys(node, "request", "method", "path", "body", "query", "headers", "auth", "bodyRaw", "contentType"); err != nil {
		return err
	}
	var fields scenarioRequestFields
	if err := node.Decode(&fields); err != nil {
		return err
	}
	*request = scenarioRequest(fields)
	return nil
}

// isScenarioPath accepts a path on the side's own host, or a placeholder that
// expands to an absolute URL ("PUT {uploadUrl}"; checked when it is built).
func isScenarioPath(path string) bool {
	return strings.HasPrefix(path, "/") || strings.HasPrefix(path, "{")
}

func isScenarioMethod(method string) bool {
	switch method {
	case http.MethodGet, http.MethodHead, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	}
	return false
}

// rejectUnknownKeys names the first mapping key a custom decoder does not know.
func rejectUnknownKeys(node *yaml.Node, kind string, allowed ...string) error {
	if node.Kind != yaml.MappingNode {
		return fmt.Errorf("line %d: %s must be a mapping", node.Line, kind)
	}
	known := map[string]bool{}
	for _, key := range allowed {
		known[key] = true
	}
	for index := 0; index+1 < len(node.Content); index += 2 {
		key := node.Content[index]
		if !known[key.Value] {
			return fmt.Errorf("line %d: unknown key %q in %s (known: %s)", key.Line, key.Value, kind, strings.Join(allowed, ", "))
		}
	}
	return nil
}

// scenarioStep is one prior (setup) or after (verify) action: a request, a
// countDelta or a mail check, optionally polled with eventually.
type scenarioStep struct {
	Request     *scenarioRequest   `yaml:"request"`
	Body        any                `yaml:"body"`
	BodyRaw     *string            `yaml:"bodyRaw"`
	ContentType string             `yaml:"contentType"`
	Query       map[string]any     `yaml:"query"`
	Headers     map[string]string  `yaml:"headers"`
	Auth        string             `yaml:"auth"`
	Capture     map[string]string  `yaml:"capture"`
	Expect      *scenarioExpect    `yaml:"expect"`
	Eventually  time.Duration      `yaml:"eventually"`
	CountDelta  *scenarioCount     `yaml:"countDelta"`
	Mail        *scenarioMail      `yaml:"mail"`
	Analytics   *scenarioAnalytics `yaml:"analytics"`
}

// scenarioCount asserts a list's length changed by By between before the
// scenario's request and after it.
type scenarioCount struct {
	Request scenarioRequest `yaml:"request"`
	Path    string          `yaml:"path"`
	By      *int            `yaml:"by"`
}

// scenarioMail asserts the side's mail sink caught a message.
type scenarioMail struct {
	To              string `yaml:"to"`
	SubjectContains string `yaml:"subjectContains"`
	BodyContains    string `yaml:"bodyContains"`
	Absent          bool   `yaml:"absent"`
}

// scenarioExpect is what a response must hold: a status, a body subset, text
// it does or does not contain, and the length of the value at Path.
type scenarioExpect struct {
	Status      intList    `yaml:"status"`
	Body        any        `yaml:"body"`
	Contains    stringList `yaml:"contains"`
	NotContains stringList `yaml:"notContains"`
	Path        string     `yaml:"path"`
	Length      *int       `yaml:"length"`
}

func (expect scenarioExpect) empty() bool {
	return len(expect.Status) == 0 && expect.Body == nil && len(expect.Contains) == 0 &&
		len(expect.NotContains) == 0 && expect.Length == nil
}

type intList []int

// UnmarshalYAML accepts one integer or a list of them.
func (list *intList) UnmarshalYAML(node *yaml.Node) error {
	if node.Kind == yaml.ScalarNode {
		var one int
		if err := node.Decode(&one); err != nil {
			return err
		}
		*list = intList{one}
		return nil
	}
	var many []int
	if err := node.Decode(&many); err != nil {
		return err
	}
	*list = many
	return nil
}

type stringList []string

// UnmarshalYAML accepts one string or a list of them.
func (list *stringList) UnmarshalYAML(node *yaml.Node) error {
	if node.Kind == yaml.ScalarNode {
		*list = stringList{node.Value}
		return nil
	}
	var many []string
	if err := node.Decode(&many); err != nil {
		return err
	}
	*list = many
	return nil
}

// loadScenarioFile parses one file and validates every scenario in it,
// answering all the problems with the file and scenario id named.
func loadScenarioFile(path string) ([]scenario, error) {
	raw, err := os.ReadFile(path) // #nosec G304 -- operator-supplied scenario file
	if err != nil {
		return nil, err
	}
	decoder := yaml.NewDecoder(bytes.NewReader(raw))
	decoder.KnownFields(true)
	var scenarios []scenario
	if err := decoder.Decode(&scenarios); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	var problems []error
	for index := range scenarios {
		scenarios[index].file = path
		scenarios[index].order = index
		for _, problem := range validateScenario(&scenarios[index]) {
			problems = append(problems, fmt.Errorf("%s: scenario %q: %s", path, scenarios[index].ID, problem))
		}
	}
	return scenarios, errors.Join(problems...)
}

// loadScenarios loads every file the glob matches (the files' names sorted),
// rejecting an id two scenarios share.
func loadScenarios(pattern string) ([]scenario, error) {
	files, err := filepath.Glob(pattern)
	if err != nil {
		return nil, fmt.Errorf("scenarios glob %q: %w", pattern, err)
	}
	if len(files) == 0 {
		return nil, fmt.Errorf("scenarios glob %q matches no file", pattern)
	}
	sort.Strings(files)
	var all []scenario
	var problems []error
	seen := map[string]string{}
	for _, file := range files {
		loaded, loadErr := loadScenarioFile(file)
		if loadErr != nil {
			problems = append(problems, loadErr)
		}
		for _, item := range loaded {
			if first, dup := seen[item.ID]; dup {
				problems = append(problems, fmt.Errorf("%s: scenario %q: id already used in %s", file, item.ID, first))
			}
			seen[item.ID] = file
			all = append(all, item)
		}
	}
	return all, errors.Join(problems...)
}

// validateScenario fills the defaults and answers what is wrong, one line each.
func validateScenario(item *scenario) []string {
	var problems []string
	if !scenarioIDPattern.MatchString(item.ID) {
		problems = append(problems, "id must be kebab-case (a-z, 0-9, dashes)")
	}
	if !scenarioEndpointPat.MatchString(item.Endpoint) {
		problems = append(problems, fmt.Sprintf("endpoint %q must read \"METHOD /path\"", item.Endpoint))
	}
	if item.Auth == "" {
		item.Auth = authProject
	}
	if !scenarioAuths[item.Auth] {
		problems = append(problems, fmt.Sprintf("auth %q is not one of %s", item.Auth, joinedKeys(scenarioAuths)))
	}
	if item.Shard == "" {
		item.Shard = shardShared
	}
	if !scenarioShards[item.Shard] {
		problems = append(problems, fmt.Sprintf("shard %q is not one of %s", item.Shard, joinedKeys(scenarioShards)))
	}
	problems = append(problems, validateMainRequest(item)...)
	problems = append(problems, validateCaptures("capture", item.Capture)...)
	for index := range item.Setup {
		problems = append(problems, validateStep(fmt.Sprintf("setup[%d]", index), &item.Setup[index], false)...)
	}
	for index := range item.Verify {
		problems = append(problems, validateStep(fmt.Sprintf("verify[%d]", index), &item.Verify[index], true)...)
	}
	for index := range item.Teardown {
		problems = append(problems, validateStep(fmt.Sprintf("teardown[%d]", index), &item.Teardown[index], false)...)
		if item.Teardown[index].Request == nil {
			problems = append(problems, fmt.Sprintf("teardown[%d]: only request steps run in teardown", index))
		}
	}
	return problems
}

func joinedKeys(set map[string]bool) string {
	keys := make([]string, 0, len(set))
	for key := range set {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return strings.Join(keys, ", ")
}

func validateMainRequest(item *scenario) []string {
	var problems []string
	if item.Request.Method == "" {
		item.Request.Method, _, _ = strings.Cut(item.Endpoint, " ")
	}
	if !isScenarioMethod(item.Request.Method) {
		problems = append(problems, fmt.Sprintf("request.method %q is not a method", item.Request.Method))
	}
	if !isScenarioPath(item.Request.Path) {
		problems = append(problems, "request.path is required and starts with / (or a {placeholder} that expands to an absolute URL)")
	}
	if item.Request.BodyRaw != nil && item.Request.Body != nil {
		problems = append(problems, "request takes body or bodyRaw, not both")
	}
	if len(item.Expect.Status) == 0 {
		problems = append(problems, "expect.status is required")
	}
	return problems
}

func validateCaptures(where string, captures map[string]string) []string {
	var problems []string
	for name := range captures {
		if !scenarioCapturePat.MatchString(name) {
			problems = append(problems, fmt.Sprintf("%s name %q must be an identifier", where, name))
		}
	}
	return problems
}

// validateStep checks one step is exactly one kind, and folds a scalar
// request's sibling body, query and headers into the request itself.
func validateStep(where string, step *scenarioStep, verify bool) []string {
	kinds := 0
	for _, present := range []bool{step.Request != nil, step.CountDelta != nil, step.Mail != nil, step.Analytics != nil} {
		if present {
			kinds++
		}
	}
	if kinds != 1 {
		return []string{where + ": a step is exactly one of request, countDelta, mail or analytics"}
	}
	if step.Eventually < 0 {
		return []string{where + ": eventually must not be negative"}
	}
	switch {
	case step.CountDelta != nil:
		return validateCountDelta(where, step.CountDelta, verify)
	case step.Mail != nil:
		return validateMail(where, step.Mail, verify)
	case step.Analytics != nil:
		return validateAnalytics(where, step.Analytics, verify)
	}
	return validateRequestStep(where, step, verify)
}

func validateRequestStep(where string, step *scenarioStep, verify bool) []string {
	request := step.Request
	if request.Body == nil {
		request.Body = step.Body
	}
	if request.BodyRaw == nil {
		request.BodyRaw = step.BodyRaw
	}
	if request.ContentType == "" {
		request.ContentType = step.ContentType
	}
	if request.Query == nil {
		request.Query = step.Query
	}
	if request.Headers == nil {
		request.Headers = step.Headers
	}
	if request.Auth == "" {
		request.Auth = step.Auth
	}
	problems := validateCaptures(where+" capture", step.Capture)
	if request.BodyRaw != nil && request.Body != nil {
		problems = append(problems, where+": a request takes body or bodyRaw, not both")
	}
	if request.Method == "" || request.Path == "" {
		problems = append(problems, where+": request needs a method and a path")
	}
	if request.Auth != "" && !scenarioAuths[request.Auth] {
		problems = append(problems, fmt.Sprintf("%s: auth %q is not one of %s", where, request.Auth, joinedKeys(scenarioAuths)))
	}
	if verify && (step.Expect == nil || len(step.Expect.Status) == 0) {
		problems = append(problems, where+": a verify request needs expect.status")
	}
	return problems
}

func validateCountDelta(where string, count *scenarioCount, verify bool) []string {
	var problems []string
	if !verify {
		problems = append(problems, where+": countDelta belongs in verify")
	}
	if count.By == nil {
		problems = append(problems, where+": countDelta.by is required (0 is a valid delta)")
	}
	if count.Request.Method != http.MethodGet || count.Request.Path == "" {
		problems = append(problems, where+": countDelta.request must be \"GET /path\"")
	}
	return problems
}

func validateMail(where string, mail *scenarioMail, verify bool) []string {
	var problems []string
	if !verify {
		problems = append(problems, where+": mail belongs in verify")
	}
	if mail.To == "" && mail.SubjectContains == "" {
		problems = append(problems, where+": mail needs to or subjectContains")
	}
	return problems
}

// selectScenarios keeps the scenarios whose id matches any -scenario-id
// pattern (path.Match syntax); no patterns keeps them all.
func selectScenarios(all []scenario, patterns []string) []scenario {
	if len(patterns) == 0 {
		return all
	}
	kept := make([]scenario, 0, len(all))
	for _, item := range all {
		if matchesAnyID(item.ID, patterns) {
			kept = append(kept, item)
		}
	}
	return kept
}
