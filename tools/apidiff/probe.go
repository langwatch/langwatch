package apidiff

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/langwatch/langwatch/tools/diffkit"
)

// bodyCaptureCap bounds each side's captured response body in a transcript.
const bodyCaptureCap = 4 << 20

// Keys are the credentials probing authenticates with. ProjectKey and OrgKey
// default to the deterministic seed constants. AdminKey is the instance admin
// key (LANGWATCH_INSTANCE_ADMIN_API_KEY); ScimKey is a SCIM provisioning
// token. ProjectKeyB/ProjectKeyC belong to the permission-probe fixtures
// (same-org sibling project, foreign-org project). A missing key never skips
// an operation: it is probed without that credential, and a 401-vs-404
// divergence is itself evidence.
type Keys struct {
	ProjectKey  string
	OrgKey      string
	AdminKey    string
	ScimKey     string
	ProjectKeyB string
	ProjectKeyC string
	// Run mode only: the widget fixture project's key and the shared secrets
	// the Langy agent stub and the gateway's signed door are configured with.
	WidgetProjectKey      string
	LangyInternalSecret   string
	GatewayInternalSecret string
}

// SideResult is one side's outcome for one probe case.
type SideResult struct {
	Status      int    `json:"status"`
	ContentType string `json:"contentType,omitempty"`
	Body        string `json:"body,omitempty"`
	LatencyMS   int64  `json:"latencyMs"`
	Error       string `json:"error,omitempty"`
	// Headers are the response's headers, for a scenario's expect.headers; never recorded.
	Headers http.Header `json:"-"`
}

// Transcript records one probe case: the request plus both sides' outcomes.
// A is the candidate (after), B the base (before). RequestPathA/RequestPathB
// keep the per-side probed path, which differ when the sides document
// different alias forms (/api/... vs /api/v1/...).
type Transcript struct {
	Method       string     `json:"method"`
	Path         string     `json:"path"`
	Case         string     `json:"case"`
	OperationID  string     `json:"operationId,omitempty"`
	RequestPathA string     `json:"requestPathA"`
	RequestPathB string     `json:"requestPathB"`
	RequestBody  any        `json:"requestBody,omitempty"`
	RequestBodyB any        `json:"requestBodyB,omitempty"`
	A            SideResult `json:"a"`
	B            SideResult `json:"b"`
}

// OpFilter narrows the operation union before probing.
type OpFilter struct {
	Method     string
	PathPrefix string
	MaxOps     int
	Only       map[string]bool // operation keys a -module scope kept; nil keeps all
}

// ProbeOptions configures a probe run against two running instances.
type ProbeOptions struct {
	A               string // candidate ("after") base URL
	B               string // base ("before") base URL
	Keys            Keys
	Schemes         map[string]map[string]any
	Timeout         time.Duration
	Filter          OpFilter
	ExcludePrefixes []string
	ExactStatus     bool // compare exact status codes and error bodies
	Client          *http.Client
	Progress        io.Writer

	// SettleTimeout bounds the event-driven wait for a created entity to
	// become visible in its collection (see settleForVisibility). Zero uses
	// defaultSettleTimeout.
	SettleTimeout time.Duration

	// OnOperationDone fires once per operation in the main pass, right after
	// its own findings are final — never for an excluded operation, and
	// never for the post-pass findings (collection/permission/entitled
	// checks), which describe a different comparison than the one operation
	// just probed.
	OnOperationDone func(Operation, []Finding)

	// ModuleOf names the module that owns an operation, and Concurrency how
	// many modules the main pass probes at once (probe-waves.go). A nil
	// ModuleOf is one module; a Concurrency below 1 is 1.
	ModuleOf    func(method, path string) string
	Concurrency int

	// ActivateEntitlement, when non-nil, lets the entitled pass elevate the
	// seeded organization to an Enterprise plan mid-run and re-probe whatever
	// the main pass saw the Enterprise gate refuse. Only `apidiff run` can
	// supply one — it alone owns the databases; see entitlement.go.
	ActivateEntitlement EntitlementActivator
}

// SuppressedCounts tallies comparisons the default semantics filtered out,
// so the summary can say how much was suppressed.
type SuppressedCounts struct {
	SameClassStatus int `json:"sameClassStatus"`
	ErrorBody       int `json:"errorBody"`
}

func (counts *SuppressedCounts) add(other SuppressedCounts) {
	counts.SameClassStatus += other.SameClassStatus
	counts.ErrorBody += other.ErrorBody
}

// ProbeResult is the outcome of a probe run.
type ProbeResult struct {
	Findings    []Finding
	Transcripts []Transcript
	Probed      int // operations actually probed (filters and excludes removed)
	Suppressed  SuppressedCounts
	// CredentialChecks is the run's own integrity reading: every credential
	// read before the first probe and again after the last. See credentials.go.
	CredentialChecks []CredentialCheck
	// Effects is each round trip's per-step outcome (roundtrip.go).
	Effects []Effect
}

// ProbeAll probes every selected operation in lockstep: each case runs on A
// and B at once, and the module's next case starts only when both answered.
// Modules run beside each other in stages (probe-waves.go); findings and
// transcripts are filed in probe order (path, then method) all the same.
func ProbeAll(ctx context.Context, options ProbeOptions, operations []Operation) ProbeResult {
	client := options.Client
	if client == nil {
		client = &http.Client{Timeout: options.Timeout, CheckRedirect: firstResponse}
	}
	engine := &probeEngine{
		ctx: ctx, options: options, client: client,
		symbolsA: NewSymbolTable(), symbolsB: NewSymbolTable(),
		ownerIDs: map[string]*sideIDs{}, statusDiffs: map[string]bool{},
		credsA: sideCredentials{}, credsB: sideCredentials{},
	}

	selected := probeOrder(SelectOperations(operations, options.Filter))

	// Read every credential before anything has had a chance to destroy one,
	// so the closing read has something to be compared against.
	canaries := engine.credentialCanaries(operations)
	credentialsBefore := engine.readCanaries(canaries)
	started := time.Now()
	engine.seedFixtures()
	engine.phaseDone("seed fixtures", started)
	defer engine.fixtureTraceSettled()

	mainStart := time.Now()
	stopTicker := diffkit.Ticker{Out: options.Progress, Label: "probe", Total: len(selected), Snapshot: engine.probeSnapshot}.Start()
	findings, probed, collectionsVerified := engine.mainPass(selected)
	stopTicker()
	engine.phaseDone("probe main pass", mainStart)
	engine.progress("timing: main pass done after %s\n", time.Since(started).Round(time.Second))

	// Post passes, after every mutation has had its chance to land.
	if !collectionsVerified {
		roundTrips := time.Now()
		findings = append(findings, engine.verifyCollections(selected)...)
		findings = append(findings, engine.roundTripPass(selected)...)
		engine.phaseDone("round trips", roundTrips)
	}
	permissions := time.Now()
	findings = append(findings, engine.permissionProbes(selected)...)
	engine.phaseDone("permission probes", permissions)
	engine.progress("timing: collection and permission passes done after %s\n", time.Since(started).Round(time.Second))
	findings = append(findings, engine.markUnverifiedLists(selected)...)
	entitled := time.Now()
	findings = append(findings, engine.entitledPass()...)
	engine.phaseDone("entitled pass", entitled)

	// The closing assertion: every credential still authenticates. A run that
	// destroyed one produced agreement, not evidence.
	checks := buildCredentialChecks(canaries, credentialsBefore, engine.readCanaries(canaries))
	engine.progress("timing: probing done after %s\n", time.Since(started).Round(time.Second))
	for _, check := range checks {
		if !check.Healthy() {
			engine.progress("credential %s: %s\n", check.Label, check.Note)
		}
	}
	return ProbeResult{
		Findings:         findings,
		Transcripts:      engine.transcripts,
		Probed:           probed,
		Suppressed:       engine.suppressed,
		CredentialChecks: checks,
		Effects:          engine.effects,
	}
}

// notProbed names why an operation is left out of the run entirely, without
// a finding: an excluded prefix, or a ruled-retired REST operation, which is
// removed rather than refused and so has nothing left to compare.
func notProbed(operation Operation, excludePrefixes []string) string {
	switch {
	case excluded(operation.Path, excludePrefixes):
		return "excluded prefix"
	case RetiredRestOperation(operation.Path):
		return "ruled retired"
	}
	return ""
}

// SelectOperations filters the union by method and path prefix and applies
// the max-ops cap, preserving the deterministic sort order.
func SelectOperations(operations []Operation, filter OpFilter) []Operation {
	selected := make([]Operation, 0, len(operations))
	for index := range operations {
		if filter.keeps(&operations[index]) {
			selected = append(selected, operations[index])
		}
	}
	if filter.MaxOps > 0 && len(selected) > filter.MaxOps {
		selected = selected[:filter.MaxOps]
	}
	return selected
}

// ScopeToModules keeps the named modules' operations plus their parameter
// producers: operations outside the scope that need no id of their own and
// whose path names a resource a kept operation needs an id for. One level,
// by name - README "Module scope" says which parameters that misses.
func ScopeToModules(union []Operation, modules []string, moduleOf func(method, path string) string) (map[string]bool, int, error) {
	wanted := map[string]bool{}
	for _, module := range modules {
		wanted[module] = true
	}
	only, matched, needed := scopedOperations(union, wanted, moduleOf)
	for _, module := range modules {
		if !matched[module] {
			return nil, 0, fmt.Errorf("-module %s: no operation in the union maps to that module", module)
		}
	}
	return only, addProducers(union, only, needed), nil
}

// scopedOperations keys the wanted modules' operations and collects the id
// buckets their parameters resolve from.
func scopedOperations(union []Operation, wanted map[string]bool, moduleOf func(method, path string) string) (only, matched, needed map[string]bool) {
	only, matched, needed = map[string]bool{}, map[string]bool{}, map[string]bool{}
	for index := range union {
		operation := &union[index]
		module := moduleOf(operation.Method, operation.Path)
		if !wanted[module] {
			continue
		}
		matched[module] = true
		only[operationKeyOf(*operation)] = true
		for _, bucket := range neededBuckets(operation) {
			needed[bucket] = true
		}
	}
	return only, matched, needed
}

// addProducers adds every unscoped operation that needs no id of its own and
// names a needed resource, returning how many it added.
func addProducers(union []Operation, only, needed map[string]bool) int {
	producers := 0
	for index := range union {
		operation := &union[index]
		key := operationKeyOf(*operation)
		if only[key] || len(neededBuckets(operation)) > 0 || !producesAny(operation, needed) {
			continue
		}
		only[key] = true
		producers++
	}
	return producers
}

// neededBuckets lists the symbol-table buckets an operation's unseeded path
// and required query parameters resolve from.
func neededBuckets(operation *Operation) []string {
	var buckets []string
	for _, param := range operation.Params {
		if param.In != "path" && (param.In != "query" || !param.Required) {
			continue
		}
		if _, seeded := SeededConstants[normalizeParamName(param.Name)]; seeded {
			continue
		}
		if param.In == "query" && param.HasValue {
			continue
		}
		buckets = append(buckets, lookupBuckets(param.Name, operation.Path)...)
	}
	return buckets
}

// producesAny reports whether a read or create names, in any literal path
// segment, a resource whose id bucket is needed.
func producesAny(operation *Operation, needed map[string]bool) bool {
	if operation.Method != http.MethodGet && operation.Method != http.MethodPost {
		return false
	}
	for _, segment := range strings.Split(strings.Trim(operation.Path, "/"), "/") {
		if segment == "" || strings.HasPrefix(segment, "{") || isVersionSegment(segment) {
			continue
		}
		if needed[normalizeParamName(singularize(segment))+"id"] {
			return true
		}
	}
	return false
}

func (filter OpFilter) keeps(operation *Operation) bool {
	if filter.Method != "" && !strings.EqualFold(operation.Method, filter.Method) {
		return false
	}
	if filter.PathPrefix != "" && !pathWithinPrefix(operation.Path, filter.PathPrefix) {
		return false
	}
	return filter.Only == nil || filter.Only[operationKeyOf(*operation)]
}

type probeEngine struct {
	ctx      context.Context
	options  ProbeOptions
	client   *http.Client
	symbolsA *SymbolTable // IDs the candidate minted; never used to probe the base
	symbolsB *SymbolTable

	suppressed  SuppressedCounts
	mutations   []mutationRecord
	ownerIDs    map[string]*sideIDs // per operation, IDs the owner key saw
	statusDiffs map[string]bool     // operations already reported as differing
	transcripts []Transcript
	effects     []Effect // round-trip outcomes, roundtrip.go
	// gatedOps are the operations the main pass saw the Enterprise gate
	// refuse on either side, keyed by operationKeyOf. See entitlement.go.
	gatedOps map[string]Operation
	// credsA and credsB are what each side minted for itself during the run
	// (side-credentials.go).
	credsA sideCredentials
	credsB sideCredentials
	// progressMu keeps lines whole when the two sides, the module lanes, the
	// collection and permission pools, and the fixture-trace wait report at once.
	progressMu sync.Mutex
	// fixtureTrace closes when the background fixture-trace wait is over.
	fixtureTrace chan struct{}
	// mu guards what module lanes probing at once share; lanes is, during a
	// stage of several, each operation's lane's own tables (probe-waves.go).
	mu    sync.Mutex
	lanes map[string][2]*SymbolTable
	// probed and differing are what the progress ticker reads while the main
	// pass runs.
	probed    atomic.Int64
	differing atomic.Int64
}

// sideIDs holds one operation's owner-visible IDs, per side.
type sideIDs struct {
	a map[string]bool
	b map[string]bool
}

func newSideIDs() *sideIDs {
	return &sideIDs{a: map[string]bool{}, b: map[string]bool{}}
}

// operationKeyOf names an operation in the engine's per-operation maps.
func operationKeyOf(operation Operation) string {
	return operation.Method + " " + operation.Path
}

func (engine *probeEngine) phaseDone(name string, started time.Time) {
	engine.progress("phase %s: %s\n", name, time.Since(started).Round(100*time.Millisecond))
}

// probeSnapshot is the main pass's progress: operations answered, and how
// many of them already differ.
func (engine *probeEngine) probeSnapshot() (int, string) {
	done, differing := int(engine.probed.Load()), int(engine.differing.Load())
	return done, fmt.Sprintf("%d agree %d differ", done-differing, differing)
}

func (engine *probeEngine) progress(format string, args ...any) {
	if engine.options.Progress != nil {
		engine.progressMu.Lock()
		defer engine.progressMu.Unlock()
		fmt.Fprintf(engine.options.Progress, format, args...)
	}
}

// probeCase is one request to execute against both sides. A curated case
// carries each side's own body, filled from that side's own ids.
type probeCase struct {
	name     string
	body     any
	bodyB    any
	perSide  bool
	captures string
	curated  *curatedCreate
}

func (engine *probeEngine) probeOperation(operation Operation) opResult {
	headers := userBoundHeaders(operation, authHeaders(operation, engine.options.Schemes, engine.options.Keys), engine.options.Keys)

	paramsA, paramsB, unresolved := engine.resolveBothSides(operation)
	if unresolved != nil {
		return opResult{findings: []Finding{*unresolved}}
	}
	engine.retargetWidgetProject(operation, &paramsA, &paramsB)
	cases, refused := engine.casesFor(operation)
	if refused != "" {
		return opResult{findings: []Finding{skippedFinding(operation, refused)}}
	}
	headersA, headersB := engine.sideHeaders(operation, headers)

	if blocked, ok := engine.guardSelfDestruction(operation, paramsA, paramsB); ok {
		return opResult{findings: blocked}
	}

	// Each side is probed at the alias form its own spec documents, with the
	// values its OWN instance minted.
	pathA, pathB := operation.SidePaths()
	target := probeTarget{
		pathA:    substitutePath(pathA, paramsA.pathValues, operation.Path),
		pathB:    substitutePath(pathB, paramsB.pathValues, operation.Path),
		queryA:   paramsA.query,
		queryB:   paramsB.query,
		headersA: headersA,
		headersB: headersB,
	}
	result := opResult{findings: make([]Finding, 0)}
	missingReported := false
	for _, probeCase := range cases {
		transcript := engine.runAndRecord(operation, probeCase, target)
		result.transcripts = append(result.transcripts, transcript)
		if !operation.InA || !operation.InB {
			if reportsMissing(operation, missingReported) {
				missingReported = true
				result.findings = append(result.findings, missingOperationFinding(operation, probeCase.name, transcript))
			}
			result.findings = append(result.findings, oneSidedServerError(operation, probeCase.name, transcript)...)
			continue
		}
		result.findings = append(result.findings, engine.compareCase(operation, probeCase, transcript)...)
		engine.recordGate(operation, transcript)
	}
	return result
}

// runAndRecord runs one case, waits out a settled read, and files the ids its
// answers carry; the rest is filed with the operation's result.
func (engine *probeEngine) runAndRecord(operation Operation, probeCase probeCase, target probeTarget) Transcript {
	transcript := engine.settleRead(operation, target, engine.runCase(operation, probeCase, target))
	engine.captureFrom(operation, probeCase, transcript)
	engine.afterCurated(probeCase, transcript)
	return transcript
}

// guardSelfDestruction keeps a destructive probe off the rows this run
// authenticates as (self-protection.go). Retargeting keeps the coverage; a
// skip announces the loss by name rather than letting it read as agreement
// later on. The second return says the operation must not be probed at all.
func (engine *probeEngine) guardSelfDestruction(operation Operation, sides ...resolvedParams) ([]Finding, bool) {
	guard := GuardSelfDestruction(operation, sides...)
	for _, note := range guard.Retargets {
		engine.progress("retarget %s %s (%s)\n", operation.Method, operation.Path, note)
	}
	if guard.Blocked == "" {
		return nil, false
	}
	engine.progress("skip %s %s (%s)\n", operation.Method, operation.Path, guard.Blocked)
	return []Finding{skippedFinding(operation, guard.Blocked)}, true
}

// captureFrom files each side's IDs from one probe case into that side's own
// symbol table.
func (engine *probeEngine) captureFrom(operation Operation, probeCase probeCase, transcript Transcript) {
	capturePath := operation.Path
	if probeCase.captures != "" {
		capturePath = probeCase.captures
	}
	symbolsA, symbolsB := engine.symbolsFor(operation)
	captureSucceeded(symbolsA, capturePath, transcript.A)
	captureSucceeded(symbolsB, capturePath, transcript.B)
	if probeCase.perSide {
		probeCase.curated.pin(symbolsA, capturePath, transcript.A)
		probeCase.curated.pin(symbolsB, capturePath, transcript.B)
	}
}

// compareCase compares one case's two outcomes and remembers whether this
// operation differs at all, which the permission pass reads to avoid
// re-reporting the same root cause once per foreign key.
func (engine *probeEngine) compareCase(operation Operation, probeCase probeCase, transcript Transcript) []Finding {
	cmp := Comparison{Method: operation.Method, Path: operation.Path, Case: probeCase.name, OperationID: operation.OperationID, ExactStatus: engine.options.ExactStatus}
	outcome := CompareResults(cmp, transcript.B, transcript.A)
	engine.mu.Lock()
	defer engine.mu.Unlock()
	for _, finding := range outcome.Findings {
		if finding.Kind == FindingStatusDiff || finding.Kind == FindingProbeFailed {
			engine.statusDiffs[operationKeyOf(operation)] = true
		}
	}
	engine.suppressed.add(outcome.Suppressed)
	return outcome.Findings
}

// unresolvedFinding explains why an operation was not probed. One side
// resolving while the other does not is a HARNESS artifact — the two
// instances mint their own IDs — and is recorded as such rather than probed
// as an asymmetric pair, which is what used to manufacture 404-vs-200.
func unresolvedFinding(operation Operation, unresolvedA, unresolvedB string) Finding {
	switch {
	case unresolvedA != "" && unresolvedB != "":
		return skippedFinding(operation, unresolvableReason(unresolvedA, operation.Path))
	case unresolvedA != "":
		return skippedFinding(operation, "parameter "+unresolvedA+" resolvable on the base only; probing both sides would compare different requests")
	default:
		return skippedFinding(operation, "parameter "+unresolvedB+" resolvable on the candidate only; probing both sides would compare different requests")
	}
}

// recordOwnerIDs remembers the IDs each side returned to the OWNER key for
// one operation, so the permission pass can tell owner data apart from
// instance-global data without an allowlist.
func (engine *probeEngine) recordOwnerIDs(operation Operation, transcript Transcript) {
	if !isReadMethod(operation.Method) || transcript.Case != "read" {
		return
	}
	key := operationKeyOf(operation)
	seen, ok := engine.ownerIDs[key]
	if !ok {
		seen = newSideIDs()
		engine.ownerIDs[key] = seen
	}
	collectBodyIDs(transcript.A.Body, seen.a)
	collectBodyIDs(transcript.B.Body, seen.b)
}

// collectBodyIDs records every id-like string value in a response body.
func collectBodyIDs(body string, into map[string]bool) {
	decoded, ok := decodeJSONBody(body)
	if !ok || decoded == nil {
		return
	}
	table := NewSymbolTable()
	for _, id := range table.Capture("", decoded) {
		into[id] = true
	}
}

// captureMutation records a successful create so the collection verification
// pass can check the entity is visible in each side's list.
func (engine *probeEngine) captureMutation(operation Operation, transcript Transcript) {
	if transcript.Case != "mutation" {
		return
	}
	if transcript.A.Status < 200 || transcript.A.Status >= 300 || transcript.B.Status < 200 || transcript.B.Status >= 300 {
		return
	}
	idA, okA := firstCapturedID(transcript.A.Body)
	idB, okB := firstCapturedID(transcript.B.Body)
	if !okA || !okB {
		return
	}
	engine.mutations = append(engine.mutations, mutationRecord{collectionPath: operation.Path, idA: idA, idB: idB})
}

// firstCapturedID returns the first id-like string in a decoded body
// (sorted-key order, deterministic).
func firstCapturedID(body string) (string, bool) {
	decoded, ok := decodeJSONBody(body)
	if !ok || decoded == nil {
		return "", false
	}
	return findFirstID(decoded)
}

func findFirstID(value any) (string, bool) {
	switch typed := value.(type) {
	case map[string]any:
		return findFirstIDInMap(typed)
	case []any:
		return findFirstIDInSlice(typed)
	default:
		return "", false
	}
}

// findFirstIDInMap prefers this object's OWN id over one nested inside it: a
// create response that wraps the entity ({"data": {...}, "id": "x"}) must
// yield the entity's id, not whichever id sorts first.
func findFirstIDInMap(object map[string]any) (string, bool) {
	for _, key := range sortedKeys(object) {
		if text, ok := object[key].(string); ok && isIDKey(key) && text != "" {
			return text, true
		}
	}
	for _, key := range sortedKeys(object) {
		if found, ok := findFirstID(object[key]); ok {
			return found, true
		}
	}
	return "", false
}

func findFirstIDInSlice(values []any) (string, bool) {
	for _, element := range values {
		if found, ok := findFirstID(element); ok {
			return found, true
		}
	}
	return "", false
}

// probeTarget is one operation's resolved request target: per-side paths with
// parameters substituted, required query parameters, and auth headers.
type probeTarget struct {
	pathA    string
	pathB    string
	queryA   url.Values
	queryB   url.Values
	headersA map[string]string
	headersB map[string]string
}

// runCase executes one probe case against both sides at once and returns when
// both have answered. The sides share no state, so each side's own order of
// requests is what lockstep keeps; the pair is still one step of the run.
func (engine *probeEngine) runCase(operation Operation, probeCase probeCase, target probeTarget) Transcript {
	transcript := Transcript{
		Method:       operation.Method,
		Path:         operation.Path,
		Case:         probeCase.name,
		OperationID:  operation.OperationID,
		RequestPathA: target.pathA,
		RequestPathB: target.pathB,
		RequestBody:  probeCase.body,
	}
	if probeCase.perSide {
		transcript.RequestBodyB = probeCase.bodyB
	}
	requestA := probeRequest{
		method: operation.Method, body: probeCase.body,
		baseURL: engine.options.A, path: target.pathA, query: target.queryA, headers: target.headersA,
	}
	requestB := requestA
	if probeCase.perSide {
		requestB.body = probeCase.bodyB
	}
	requestB.baseURL, requestB.path, requestB.query, requestB.headers = engine.options.B, target.pathB, target.queryB, target.headersB
	var group sync.WaitGroup
	group.Go(func() { transcript.A = engine.execute(requestA) })
	transcript.B = engine.execute(requestB)
	group.Wait()
	return transcript
}

// reportsMissing is whether a one-sided operation still owes its finding:
// once per operation, and never for a ruled-retired one.
func reportsMissing(operation Operation, alreadyReported bool) bool {
	return !alreadyReported && !RetiredRestOperation(operation.Path)
}

// oneSidedServerError is a status_diff for a branch 5xx where main answered
// otherwise: an operation only one side documents is still served by both,
// and operation_missing alone would hide the regression.
func oneSidedServerError(operation Operation, caseName string, transcript Transcript) []Finding {
	branch, main := statusClass(transcript.A.Status), statusClass(transcript.B.Status)
	if branch != "server-error" || main == "server-error" {
		return nil
	}
	return []Finding{{
		Kind: FindingStatusDiff, Method: operation.Method, Path: operation.Path, Case: caseName,
		OperationID: operation.OperationID,
		Fields: map[string][2]any{
			"status": {transcript.B.Status, transcript.A.Status},
			"class":  {main, branch},
		},
	}}
}

// missingOperationFinding records an operation present on only one side,
// with both sides' statuses as evidence.
func missingOperationFinding(operation Operation, caseName string, transcript Transcript) Finding {
	return Finding{
		Kind:        FindingOperationMissing,
		Method:      operation.Method,
		Path:        operation.Path,
		Case:        caseName,
		OperationID: operation.OperationID,
		Fields: map[string][2]any{
			"presence": {presenceLabel(operation.InB), presenceLabel(operation.InA)},
			"status":   {transcript.B.Status, transcript.A.Status},
		},
	}
}

// probeRequest is one side's request for one probe case.
type probeRequest struct {
	baseURL string
	method  string
	path    string
	query   url.Values
	headers map[string]string
	body    any
	raw     *string // scenario steps: sent as it is, not as JSON
}

// execute performs one request against one instance and captures the outcome.
// Idempotent methods (GET/HEAD/OPTIONS) retry up to probeMaxRetries times on
// 5xx with backoff: a momentary database restart or recovery window degrades
// into a slow probe instead of a false "behavioral diff". Mutations are never
// retried — replaying one could double-apply.
func (engine *probeEngine) execute(probe probeRequest) SideResult {
	var encoded []byte
	if probe.body != nil {
		var err error
		encoded, err = json.Marshal(probe.body)
		if err != nil {
			return SideResult{Error: "encode request body: " + err.Error()}
		}
	}
	result := engine.executeOnce(probe, encoded)
	for attempt := 0; attempt < probeMaxRetries && shouldRetry5xx(probe.method, result); attempt++ {
		engine.progress("retry %s %s after %d (attempt %d/%d)\n", probe.method, probe.path, result.Status, attempt+2, probeMaxRetries+1)
		if !engine.backoff(attempt) {
			return result
		}
		result = engine.executeOnce(probe, encoded)
	}
	return result
}

const probeMaxRetries = 2

// shouldRetry5xx reports whether the outcome is worth retrying: idempotent
// methods only, server errors only, never transport errors (those fail fast).
func shouldRetry5xx(method string, result SideResult) bool {
	if result.Error != "" || result.Status < 500 {
		return false
	}
	switch method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return true
	default:
		return false
	}
}

// backoff waits (500ms, then 1s); false means the context ended mid-wait.
func (engine *probeEngine) backoff(attempt int) bool {
	select {
	case <-engine.ctx.Done():
		return false
	case <-time.After(time.Duration(attempt+1) * 500 * time.Millisecond):
		return true
	}
}

// executeOnce performs a single request attempt.
func (engine *probeEngine) executeOnce(probe probeRequest, encoded []byte) SideResult {
	var reader io.Reader
	if encoded != nil {
		reader = bytes.NewReader(encoded)
	}
	target := strings.TrimSuffix(probe.baseURL, "/") + probe.path
	if len(probe.query) > 0 {
		target += "?" + probe.query.Encode()
	}
	request, err := http.NewRequestWithContext(engine.ctx, probe.method, target, reader)
	if err != nil {
		return SideResult{Error: err.Error()}
	}
	for name, value := range probe.headers {
		request.Header.Set(name, value)
	}
	if encoded != nil && request.Header.Get("Content-Type") == "" {
		request.Header.Set("Content-Type", "application/json")
	}
	request.Header.Set("Accept", "application/json")

	started := time.Now()
	response, err := engine.client.Do(request)
	if err != nil {
		return SideResult{Error: err.Error()}
	}
	defer response.Body.Close()
	captured, readErr := io.ReadAll(io.LimitReader(response.Body, bodyCaptureCap))
	result := SideResult{
		Status:      response.StatusCode,
		ContentType: response.Header.Get("Content-Type"),
		Body:        string(captured),
		LatencyMS:   time.Since(started).Milliseconds(),
		Headers:     response.Header,
	}
	if readErr != nil {
		result.Error = "read response: " + readErr.Error()
	}
	return result
}

// decodedBody parses a captured response body, or nil when it is not JSON.
// Each side's IDs are filed into THAT side's symbol table, so a value minted
// by one instance can never be substituted into the other's request.
func decodedBody(body string) any {
	decoded, ok := decodeJSONBody(body)
	if !ok {
		return nil
	}
	return decoded
}

// operationCases picks the probe cases for an operation: one read for
// GET/HEAD/OPTIONS, validation + valid mutation for write methods, one
// delete for DELETE.
func operationCases(operation Operation) []probeCase {
	switch operation.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions, http.MethodTrace:
		return []probeCase{{name: "read"}}
	case http.MethodPost, http.MethodPut, http.MethodPatch:
		if operation.BodySchema == nil {
			return []probeCase{{name: "mutation"}}
		}
		if len(operation.BodySchema) == 0 {
			// An empty schema accepts any JSON, so a validation case asks nothing
			// the mutation does not; the body carries its media type all the same.
			return []probeCase{{name: "mutation", body: map[string]any{}}}
		}
		return []probeCase{
			{name: "validation", body: ValidationBody(operation.BodySchema)},
			{name: "mutation", body: SynthesizePayload(operation.BodySchema, 0)},
		}
	case http.MethodDelete:
		return []probeCase{{name: "delete"}}
	default:
		return []probeCase{{name: "read"}}
	}
}

// resolvedParams carries resolved path values and the required query string.
type resolvedParams struct {
	pathValues map[string]string
	query      url.Values
}

// resolveParams resolves path and required query parameters against ONE
// side's symbol table; the caller resolves once per side. DELETE operations
// resolve only from captured or seeded IDs — never from spec examples — so an
// example cannot delete seeded state.
func resolveParams(operation Operation, symbols *SymbolTable, idsOnly bool) (resolvedParams, string) {
	resolver := paramResolver{symbols: symbols, operationPath: operation.Path, idsOnly: idsOnly}
	params := resolvedParams{pathValues: map[string]string{}, query: url.Values{}}
	for _, param := range operation.Params {
		if param.In != "path" && (param.In != "query" || !param.Required) {
			continue
		}
		value, ok := resolver.resolve(param)
		if !ok {
			return resolvedParams{}, param.Name
		}
		if param.In == "path" {
			params.pathValues[param.Name] = value
			continue
		}
		params.query.Set(param.Name, value)
	}
	return params, ""
}

// substitutePath replaces {param} placeholders in one side's path form. Values
// are resolved under the CANDIDATE's parameter names (the merged operation's),
// so a side that spells the same parameter differently — base
// "/api/projects/{id}", candidate "/api/projects/{projectId}" — is filled
// positionally against `canonical`. Pairing keeps arity in the key, so the two
// templates always carry the same number of placeholders in the same order.
// Without the fallback that side is sent its template verbatim.
func substitutePath(template string, values map[string]string, canonical string) string {
	path := template
	for name, value := range values {
		path = strings.ReplaceAll(path, "{"+name+"}", url.PathEscape(value))
	}
	if !strings.Contains(path, "{") {
		return path
	}
	canonicalNames := pathPlaceholders(canonical)
	for index, name := range pathPlaceholders(template) {
		if index >= len(canonicalNames) {
			break
		}
		value, ok := values[canonicalNames[index]]
		if !ok {
			continue
		}
		path = strings.Replace(path, "{"+name+"}", url.PathEscape(value), 1)
	}
	return path
}

// pathPlaceholders lists a template's {param} names, in order.
func pathPlaceholders(template string) []string {
	matches := pathParameter.FindAllString(template, -1)
	names := make([]string, 0, len(matches))
	for _, match := range matches {
		names = append(names, strings.Trim(match, "{}"))
	}
	return names
}

// paramResolver resolves parameters for one operation; idsOnly restricts
// resolution to seeded constants and captured IDs.
type paramResolver struct {
	symbols       *SymbolTable
	operationPath string
	idsOnly       bool
}

func (resolver paramResolver) resolve(param Param) (string, bool) {
	if resolver.idsOnly {
		return resolveIDParam(param, resolver.symbols, resolver.operationPath)
	}
	return ResolveParam(param, resolver.symbols, resolver.operationPath)
}

// resolveIDParam resolves a parameter from seeded constants or the symbol
// table only.
func resolveIDParam(param Param, symbols *SymbolTable, operationPath string) (string, bool) {
	if value, ok := SeededConstants[normalizeParamName(param.Name)]; ok {
		return value, true
	}
	return symbols.Lookup(param.Name, operationPath)
}

// authHeaders builds the credential headers for an operation from its
// security schemes. Schemes without a matching key contribute no header —
// the operation is still probed, unauthenticated for that scheme.
func authHeaders(operation Operation, schemes map[string]map[string]any, keys Keys) map[string]string {
	headers := map[string]string{}
	for _, name := range operation.Security {
		cred := schemeHeader(name, schemes[name], keys)
		if cred.header != "" {
			headers[cred.header] = cred.value
		}
	}
	return headers
}

// credential is one resolved auth header; an empty header means "no key
// available, probe without it".
type credential struct {
	header string
	value  string
}

// schemeHeader classifies one security scheme and maps it to a credential.
// The served spec's scheme names are load-bearing: admin_api_key is an
// ORGANIZATION bearer the seeded private access token satisfies, while
// instance_admin_key and scim_bearer take the admin/SCIM keys.
func schemeHeader(name string, scheme map[string]any, keys Keys) credential {
	normalized := strings.NewReplacer("_", "", "-", "").Replace(strings.ToLower(name))
	if strings.Contains(normalized, "instanceadmin") {
		return bearerOrHeader(scheme, keys.AdminKey)
	}
	if strings.Contains(normalized, "scim") {
		return bearerOrHeader(scheme, keys.ScimKey)
	}
	if isHTTPBearer(scheme) {
		return bearerCredential(keys.OrgKey)
	}
	if header := apiKeyHeader(scheme); header != "" {
		return headerCredential(header, keys.ProjectKey)
	}
	if strings.Contains(normalized, "bearer") || strings.Contains(normalized, "org") {
		return bearerCredential(keys.OrgKey)
	}
	return headerCredential("X-Auth-Token", keys.ProjectKey)
}

// bearerCredential builds an Authorization: Bearer credential, empty when the
// key is missing.
func bearerCredential(key string) credential {
	if key == "" {
		return credential{}
	}
	return credential{header: "Authorization", value: "Bearer " + key}
}

// bearerOrHeader honors an apiKey scheme's declared header before falling
// back to the bearer form.
func bearerOrHeader(scheme map[string]any, key string) credential {
	if key == "" {
		return credential{}
	}
	if header := apiKeyHeader(scheme); header != "" {
		return credential{header: header, value: key}
	}
	return bearerCredential(key)
}

func headerCredential(header, key string) credential {
	if key == "" {
		return credential{}
	}
	return credential{header: header, value: key}
}

func isHTTPBearer(scheme map[string]any) bool {
	schemeType, _ := scheme["type"].(string)
	if schemeType != "http" {
		return false
	}
	schemeName, _ := scheme["scheme"].(string)
	return strings.EqualFold(schemeName, "bearer")
}

// apiKeyHeader returns the header name an apiKey scheme declares, or "".
func apiKeyHeader(scheme map[string]any) string {
	if schemeType, _ := scheme["type"].(string); schemeType != "apiKey" {
		return ""
	}
	header, _ := scheme["name"].(string)
	return header
}

func skippedFinding(operation Operation, reason string) Finding {
	return Finding{
		Kind:        FindingSkipped,
		Method:      operation.Method,
		Path:        operation.Path,
		OperationID: operation.OperationID,
		Reason:      reason,
	}
}

func presenceLabel(present bool) string {
	if present {
		return "present"
	}
	return "absent"
}

func excluded(path string, prefixes []string) bool {
	for _, prefix := range prefixes {
		if pathWithinPrefix(path, prefix) {
			return true
		}
	}
	return false
}

func pathWithinPrefix(path, prefix string) bool {
	return prefix == "" || path == prefix || strings.HasPrefix(path, prefix+"/")
}

// firstResponse makes an http.Client return a redirect as the route's own
// answer instead of following it.
func firstResponse(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
