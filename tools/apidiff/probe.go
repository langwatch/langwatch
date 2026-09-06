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
	"time"
)

// bodyCaptureCap bounds each side's captured response body in a transcript.
const bodyCaptureCap = 64 << 10

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
}

// SideResult is one side's outcome for one probe case.
type SideResult struct {
	Status      int    `json:"status"`
	ContentType string `json:"contentType,omitempty"`
	Body        string `json:"body,omitempty"`
	LatencyMS   int64  `json:"latencyMs"`
	Error       string `json:"error,omitempty"`
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
	A            SideResult `json:"a"`
	B            SideResult `json:"b"`
}

// OpFilter narrows the operation union before probing.
type OpFilter struct {
	Method     string
	PathPrefix string
	MaxOps     int
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
}

// ProbeAll probes every selected operation in lockstep: each case runs on A
// then immediately on B, keeping both databases in the same state. Operations
// run in deterministic order (sorted by path, then method).
func ProbeAll(ctx context.Context, options ProbeOptions, operations []Operation) ProbeResult {
	client := options.Client
	if client == nil {
		client = &http.Client{Timeout: options.Timeout}
	}
	engine := &probeEngine{
		ctx: ctx, options: options, client: client,
		symbolsA: NewSymbolTable(), symbolsB: NewSymbolTable(),
		ownerIDs: map[string]*sideIDs{}, statusDiffs: map[string]bool{},
	}

	selected := SelectOperations(operations, options.Filter)

	findings := make([]Finding, 0)
	probed := 0
	for index := range selected {
		operation := selected[index]
		if excluded(operation.Path, options.ExcludePrefixes) {
			engine.progress("skip %s %s (excluded prefix) [%d/%d]\n", operation.Method, operation.Path, index+1, len(selected))
			continue
		}
		engine.progress("probe %s %s [%d/%d]\n", operation.Method, operation.Path, index+1, len(selected))
		probed++
		findings = append(findings, engine.probeOperation(operation)...)
	}

	// Post passes, after every mutation has had its chance to land.
	findings = append(findings, engine.verifyCollections(selected)...)
	findings = append(findings, engine.permissionProbes(selected)...)
	findings = append(findings, engine.markUnverifiedLists(selected)...)
	return ProbeResult{Findings: findings, Transcripts: engine.transcripts, Probed: probed, Suppressed: engine.suppressed}
}

// SelectOperations filters the union by method and path prefix and applies
// the max-ops cap, preserving the deterministic sort order.
func SelectOperations(operations []Operation, filter OpFilter) []Operation {
	selected := make([]Operation, 0, len(operations))
	for index := range operations {
		operation := operations[index]
		if filter.Method != "" && !strings.EqualFold(operation.Method, filter.Method) {
			continue
		}
		if filter.PathPrefix != "" && !pathWithinPrefix(operation.Path, filter.PathPrefix) {
			continue
		}
		selected = append(selected, operation)
	}
	if filter.MaxOps > 0 && len(selected) > filter.MaxOps {
		selected = selected[:filter.MaxOps]
	}
	return selected
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

func (engine *probeEngine) progress(format string, args ...any) {
	if engine.options.Progress != nil {
		fmt.Fprintf(engine.options.Progress, format, args...)
	}
}

// probeCase is one request to execute against both sides.
type probeCase struct {
	name string
	body any
}

func (engine *probeEngine) probeOperation(operation Operation) []Finding {
	headers := authHeaders(operation, engine.options.Schemes, engine.options.Keys)

	deleteOp := operation.Method == http.MethodDelete
	paramsA, unresolvedA := resolveParams(operation, engine.symbolsA, deleteOp)
	paramsB, unresolvedB := resolveParams(operation, engine.symbolsB, deleteOp)
	if unresolvedA != "" || unresolvedB != "" {
		return []Finding{unresolvedFinding(operation, unresolvedA, unresolvedB)}
	}

	// Each side is probed at the alias form its own spec documents, with the
	// values its OWN instance minted.
	pathA, pathB := operation.SidePaths()
	target := probeTarget{
		pathA:   substitutePath(pathA, paramsA.pathValues),
		pathB:   substitutePath(pathB, paramsB.pathValues),
		queryA:  paramsA.query,
		queryB:  paramsB.query,
		headers: headers,
	}
	findings := make([]Finding, 0)
	missingReported := false
	for _, probeCase := range operationCases(operation) {
		transcript := engine.runCase(operation, probeCase, target)
		engine.transcripts = append(engine.transcripts, transcript)
		engine.captureFrom(operation, probeCase, transcript)

		if !operation.InA || !operation.InB {
			if !missingReported {
				missingReported = true
				findings = append(findings, missingOperationFinding(operation, probeCase.name, transcript))
			}
			continue
		}
		findings = append(findings, engine.compareCase(operation, probeCase, transcript)...)
	}
	return findings
}

// captureFrom files everything one probe case taught the engine: each side's
// IDs into its own symbol table, the owner-visible IDs, and any create.
func (engine *probeEngine) captureFrom(operation Operation, probeCase probeCase, transcript Transcript) {
	engine.symbolsA.Capture(operation.Path, decodedBody(transcript.A.Body))
	engine.symbolsB.Capture(operation.Path, decodedBody(transcript.B.Body))
	engine.recordOwnerIDs(operation, probeCase, transcript)
	engine.captureMutation(operation, probeCase, transcript)
}

// compareCase compares one case's two outcomes and remembers whether this
// operation differs at all, which the permission pass reads to avoid
// re-reporting the same root cause once per foreign key.
func (engine *probeEngine) compareCase(operation Operation, probeCase probeCase, transcript Transcript) []Finding {
	cmp := Comparison{Method: operation.Method, Path: operation.Path, Case: probeCase.name, OperationID: operation.OperationID, ExactStatus: engine.options.ExactStatus}
	outcome := CompareResults(cmp, transcript.B, transcript.A)
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
		return skippedFinding(operation, "unresolvable parameter: "+unresolvedA)
	case unresolvedA != "":
		return skippedFinding(operation, "parameter "+unresolvedA+" resolvable on the base only; probing both sides would compare different requests")
	default:
		return skippedFinding(operation, "parameter "+unresolvedB+" resolvable on the candidate only; probing both sides would compare different requests")
	}
}

// recordOwnerIDs remembers the IDs each side returned to the OWNER key for
// one operation, so the permission pass can tell owner data apart from
// instance-global data without an allowlist.
func (engine *probeEngine) recordOwnerIDs(operation Operation, probeCase probeCase, transcript Transcript) {
	if !isReadMethod(operation.Method) || probeCase.name != "read" {
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
func (engine *probeEngine) captureMutation(operation Operation, probeCase probeCase, transcript Transcript) {
	if probeCase.name != "mutation" {
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
	pathA   string
	pathB   string
	queryA  url.Values
	queryB  url.Values
	headers map[string]string
}

// runCase executes one probe case against both sides in lockstep (A then B).
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
	request := probeRequest{
		method:  operation.Method,
		headers: target.headers,
		body:    probeCase.body,
	}
	request.baseURL = engine.options.A
	request.path = target.pathA
	request.query = target.queryA
	transcript.A = engine.execute(request)
	request.baseURL = engine.options.B
	request.path = target.pathB
	request.query = target.queryB
	transcript.B = engine.execute(request)
	return transcript
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
	if encoded != nil {
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

// substitutePath replaces {param} placeholders in one side's path form.
func substitutePath(template string, values map[string]string) string {
	path := template
	for name, value := range values {
		path = strings.ReplaceAll(path, "{"+name+"}", url.PathEscape(value))
	}
	return path
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
