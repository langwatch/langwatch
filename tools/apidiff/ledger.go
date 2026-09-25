package apidiff

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"sort"
	"strconv"
	"strings"
)

// The ledger is the burn-down view of a run. A report of 78 difference rows
// is a list to sort by hand; the same run's ledger is "13 causes across 41
// operations", because every row carries a ROOT CAUSE — a stable slug the
// tool derives from the finding's kind, the status pair, and (for a skip)
// whether the harness or the API was the reason. Causes are what a branch
// drives to zero: -ledger-baseline marks the ones already known, and only a
// new cause fails the run.

// Classification is the closed enum one operation's outcome falls into.
const (
	ClassificationEqual           = "equal"
	ClassificationEqualSuppressed = "equal-suppressed"
	ClassificationDiffers         = "differs"
	ClassificationMissingA        = "missing-a"
	ClassificationMissingB        = "missing-b"
	ClassificationSkipped         = "skipped"
	ClassificationNotProbed       = "not-probed"
	ClassificationUnverified      = "unverified"
)

// Classifications lists the enum in report order.
var Classifications = []string{
	ClassificationEqual,
	ClassificationEqualSuppressed,
	ClassificationDiffers,
	ClassificationMissingA,
	ClassificationMissingB,
	ClassificationSkipped,
	ClassificationNotProbed,
	ClassificationUnverified,
}

// LedgerRow is one operation in the union, whether or not it differed.
type LedgerRow struct {
	Method         string   `json:"method"`
	Path           string   `json:"path"`
	OperationID    string   `json:"operationId,omitempty"`
	Presence       string   `json:"presence"` // both | candidate-only | base-only
	Cases          []string `json:"cases"`
	Classification string   `json:"classification"`
	RootCauses     []string `json:"rootCauses"`
	SkipReason     string   `json:"skipReason,omitempty"`
	SideStatus     *[2]int  `json:"sideStatus,omitempty"` // [base, candidate]
	Known          bool     `json:"known"`                // every cause is in the baseline
	Module         string   `json:"module"`
	CoverageNote   string   `json:"coverageNote,omitempty"`
}

// LedgerCause groups every row sharing one root cause.
type LedgerCause struct {
	RootCause  string   `json:"rootCause"`
	Kind       string   `json:"kind"`
	Count      int      `json:"count"` // findings carrying this cause
	Operations []string `json:"operations"`
	Known      bool     `json:"known"` // present in the -ledger-baseline
}

// LedgerTotals is the burn-down headline.
type LedgerTotals struct {
	UnionOperations int `json:"unionOperations"`
	Probed          int `json:"probed"`
	Skipped         int `json:"skipped"`
	Differing       int `json:"differingOperations"`
	Causes          int `json:"causes"`
	NewCauses       int `json:"newCauses"`
	KnownCauses     int `json:"knownCauses"`
	Modules         int `json:"modules"`
	Unmapped        int `json:"unmappedOperations"`
	CoverageNotes   int `json:"coverageNotes"`
}

// LedgerModule is one module's slice of the run: the work packet a lane
// owning that module burns down.
type LedgerModule struct {
	Module        string              `json:"module"` // empty: no module claims the path
	Operations    int                 `json:"operations"`
	Differing     int                 `json:"differingOperations"`
	NewCauses     int                 `json:"newCauses"`
	CoverageNotes int                 `json:"coverageNotes"`
	Causes        []LedgerModuleCause `json:"causes"`
}

// LedgerModuleCause is one cause as it lands in one module.
type LedgerModuleCause struct {
	RootCause  string   `json:"rootCause"`
	Known      bool     `json:"known"`
	Operations []string `json:"operations"`
}

// LedgerCoverageNote counts operations the harness could not compare. A note
// is never a cause: it is not in the baseline ratchet and never fails a run.
type LedgerCoverageNote struct {
	Note       string   `json:"note"`
	Count      int      `json:"count"`
	Operations []string `json:"operations"`
}

// LedgerScope names each operation's module and, under -module, the
// operations the run covered; the zero value keeps the whole union unnamed.
type LedgerScope struct {
	Modules  []string
	ModuleOf func(method, path string) string
	Only     map[string]bool
}

// Ledger is the machine-readable per-operation view, written beside the
// report as ledger.json.
type Ledger struct {
	Totals        LedgerTotals         `json:"totals"`
	Scope         []string             `json:"scope,omitempty"`
	Modules       []LedgerModule       `json:"modules"`
	Causes        []LedgerCause        `json:"causes"`
	CoverageNotes []LedgerCoverageNote `json:"coverageNotes"`
	Operations    []LedgerRow          `json:"operations"`
}

// ledgerBuild accumulates the rows and cause groups while folding a run.
type ledgerBuild struct {
	rows     map[string]*LedgerRow
	order    []string
	causes   map[string]*LedgerCause
	notes    map[string]*LedgerCoverageNote
	baseline map[string]bool
	scope    LedgerScope
}

// LedgerOptions are what a ledger is folded against: the known causes (may
// be nil) and the module scope (the zero value names no modules).
type LedgerOptions struct {
	Baseline map[string]bool
	Scope    LedgerScope
}

// BuildLedger folds the union, the findings and the spec changes into one
// row per operation plus the cause groups. baseline may be nil.
func BuildLedger(union []Operation, report Report, baseline map[string]bool) Ledger {
	return BuildScopedLedger(union, report, LedgerOptions{Baseline: baseline})
}

// BuildScopedLedger is BuildLedger with a module scope: every row names its
// module, the module view is filled in, and a -module run keeps its own rows.
func BuildScopedLedger(union []Operation, report Report, options LedgerOptions) Ledger {
	build := &ledgerBuild{
		rows:     map[string]*LedgerRow{},
		causes:   map[string]*LedgerCause{},
		notes:    map[string]*LedgerCoverageNote{},
		baseline: options.Baseline,
		scope:    options.Scope,
	}
	build.seedRows(union)
	build.applyTranscripts(report.Transcripts)
	build.applyFindings(report.Findings)
	build.applySpecChanges(report.SpecChanges)
	return build.finish()
}

// seedRows creates one row per union operation, in the union's own order.
func (build *ledgerBuild) seedRows(union []Operation) {
	for index := range union {
		operation := union[index]
		key := operationKeyOf(operation)
		if !build.inScope(key) {
			continue
		}
		row := &LedgerRow{
			Method:         operation.Method,
			Path:           operation.Path,
			OperationID:    operation.OperationID,
			Presence:       presenceOf(operation),
			Cases:          []string{},
			Classification: ClassificationNotProbed,
			RootCauses:     []string{},
			Module:         build.moduleOf(operation.Method, operation.Path),
		}
		build.rows[key] = row
		build.order = append(build.order, key)
	}
}

func presenceOf(operation Operation) string {
	switch {
	case operation.InA && operation.InB:
		return "both"
	case operation.InA:
		return "candidate-only"
	default:
		return "base-only"
	}
}

// applyTranscripts records which cases ran and each operation's status pair.
func (build *ledgerBuild) applyTranscripts(transcripts []Transcript) {
	for index := range transcripts {
		transcript := transcripts[index]
		row, ok := build.rows[transcript.Method+" "+transcript.Path]
		if !ok {
			continue
		}
		if !contains(row.Cases, transcript.Case) {
			row.Cases = append(row.Cases, transcript.Case)
		}
		if row.SideStatus == nil {
			row.SideStatus = &[2]int{transcript.B.Status, transcript.A.Status}
		}
		if row.Classification == ClassificationNotProbed {
			row.Classification = ClassificationEqual
		}
	}
}

// applyFindings attaches each finding's root cause to its row and to the
// cause group, and lifts the row's classification.
func (build *ledgerBuild) applyFindings(findings []Finding) {
	for index := range findings {
		finding := findings[index]
		key := finding.Method + " " + finding.Path
		row, ok := build.rowFor(finding, key)
		if !ok {
			continue
		}
		cause := RootCause(finding)
		build.classify(row, finding)
		if IsCoverageNote(cause) {
			if row.CoverageNote == "" {
				row.CoverageNote = cause
			}
			build.recordNote(cause, key)
			continue
		}
		if !contains(row.RootCauses, cause) {
			row.RootCauses = append(row.RootCauses, cause)
		}
		build.recordCause(cause, finding.Kind, key)
	}
}

// rowFor finds a finding's row, creating one for an operation the union did
// not list unless a -module scope leaves it out.
func (build *ledgerBuild) rowFor(finding Finding, key string) (*LedgerRow, bool) {
	if row, ok := build.rows[key]; ok {
		return row, true
	}
	if !build.inScope(key) {
		return nil, false
	}
	row := &LedgerRow{
		Method: finding.Method, Path: finding.Path, OperationID: finding.OperationID,
		Presence: "both", Cases: []string{}, Classification: ClassificationEqual, RootCauses: []string{},
		Module: build.moduleOf(finding.Method, finding.Path),
	}
	build.rows[key] = row
	build.order = append(build.order, key)
	return row, true
}

// classify lifts a row's classification for one finding. differs wins over
// everything; a missing operation reports which side lost it.
func (build *ledgerBuild) classify(row *LedgerRow, finding Finding) {
	switch finding.Kind {
	case FindingSkipped:
		if row.Classification == ClassificationEqual || row.Classification == ClassificationNotProbed {
			row.Classification = ClassificationSkipped
			row.SkipReason = finding.Reason
		}
	case FindingUnverifiedShape:
		if row.Classification == ClassificationEqual || row.Classification == ClassificationNotProbed {
			row.Classification = ClassificationUnverified
		}
	case FindingOperationMissing:
		if row.Presence == "candidate-only" {
			row.Classification = ClassificationMissingB
			return
		}
		row.Classification = ClassificationMissingA
	default:
		row.Classification = ClassificationDiffers
	}
}

// applySpecChanges records the document-level differences as causes of their
// own, on the operation's row when the union has one.
func (build *ledgerBuild) applySpecChanges(changes []SpecChange) {
	for index := range changes {
		change := changes[index]
		cause := "spec-" + strings.ReplaceAll(change.Kind, "_", "-")
		key := strings.ToUpper(change.Method) + " " + CanonicalAliasPath(change.Path)
		if !build.inScope(key) {
			continue
		}
		if row, ok := build.rows[key]; ok && !contains(row.RootCauses, cause) {
			row.RootCauses = append(row.RootCauses, cause)
		}
		build.recordCause(cause, change.Kind, key)
	}
}

func (build *ledgerBuild) recordCause(cause, kind, operationKey string) {
	group, ok := build.causes[cause]
	if !ok {
		group = &LedgerCause{RootCause: cause, Kind: kind, Known: build.baseline[cause] || isAcceptedImprovement(cause)}
		build.causes[cause] = group
	}
	group.Count++
	if !contains(group.Operations, operationKey) {
		group.Operations = append(group.Operations, operationKey)
	}
}

// coverageNoteCauses are the skip slugs that say the harness could not reach
// an operation, not that the branch behaves differently (README, "The ledger").
var coverageNoteCauses = map[string]bool{
	"unresolvable-parameter": true,
	"harness-symbol-table":   true,
}

// IsCoverageNote reports whether a cause slug is a coverage note rather than
// a cause, in either pass.
func IsCoverageNote(cause string) bool {
	return coverageNoteCauses[strings.TrimPrefix(cause, "entitled:")]
}

func (build *ledgerBuild) inScope(key string) bool {
	return build.scope.Only == nil || build.scope.Only[key]
}

func (build *ledgerBuild) moduleOf(method, path string) string {
	if build.scope.ModuleOf == nil {
		return ""
	}
	return build.scope.ModuleOf(method, path)
}

func (build *ledgerBuild) recordNote(note, operationKey string) {
	group, ok := build.notes[note]
	if !ok {
		group = &LedgerCoverageNote{Note: note}
		build.notes[note] = group
	}
	group.Count++
	if !contains(group.Operations, operationKey) {
		group.Operations = append(group.Operations, operationKey)
	}
}

// finish sorts everything deterministically and computes the totals.
func (build *ledgerBuild) finish() Ledger {
	ledger := Ledger{Scope: build.scope.Modules}
	ledger.Operations, ledger.Totals = build.finishRows()
	ledger.Causes = build.finishCauses(&ledger.Totals)
	ledger.CoverageNotes = build.finishNotes()
	ledger.Modules = build.finishModules(ledger.Operations, ledger.Causes)
	ledger.Totals.UnionOperations = len(ledger.Operations)
	ledger.Totals.Causes = len(ledger.Causes)
	ledger.Totals.Modules = len(ledger.Modules)
	for index := range ledger.Operations {
		if ledger.Operations[index].Module == "" {
			ledger.Totals.Unmapped++
		}
		if ledger.Operations[index].CoverageNote != "" {
			ledger.Totals.CoverageNotes++
		}
	}
	return ledger
}

func (build *ledgerBuild) finishNotes() []LedgerCoverageNote {
	names := make([]string, 0, len(build.notes))
	for name := range build.notes {
		names = append(names, name)
	}
	sort.Strings(names)
	notes := make([]LedgerCoverageNote, 0, len(names))
	for _, name := range names {
		group := build.notes[name]
		sort.Strings(group.Operations)
		notes = append(notes, *group)
	}
	return notes
}

// finishModules regroups rows and causes by module: module -> cause ->
// operations, ordered by module name with the unmapped group last.
func (build *ledgerBuild) finishModules(rows []LedgerRow, causes []LedgerCause) []LedgerModule {
	grouper := moduleGrouper{groups: map[string]*LedgerModule{}, causes: map[string]map[string]*LedgerModuleCause{}}
	rowModule := map[string]string{}
	for index := range rows {
		row := &rows[index]
		rowModule[row.Method+" "+row.Path] = row.Module
		grouper.addRow(row)
	}
	for index := range causes {
		cause := &causes[index]
		for _, key := range cause.Operations {
			module, ok := rowModule[key]
			if !ok {
				module = build.moduleOfKey(key)
			}
			grouper.addCause(module, cause, key)
		}
	}
	return grouper.ordered()
}

func (build *ledgerBuild) moduleOfKey(key string) string {
	method, path, _ := strings.Cut(key, " ")
	return build.moduleOf(method, path)
}

// moduleGrouper accumulates the module view.
type moduleGrouper struct {
	groups map[string]*LedgerModule
	causes map[string]map[string]*LedgerModuleCause
}

func (grouper moduleGrouper) group(module string) *LedgerModule {
	if existing, ok := grouper.groups[module]; ok {
		return existing
	}
	created := &LedgerModule{Module: module, Causes: []LedgerModuleCause{}}
	grouper.groups[module] = created
	grouper.causes[module] = map[string]*LedgerModuleCause{}
	return created
}

func (grouper moduleGrouper) addRow(row *LedgerRow) {
	moduleGroup := grouper.group(row.Module)
	moduleGroup.Operations++
	if isDiffering(row.Classification) {
		moduleGroup.Differing++
	}
	if row.CoverageNote != "" {
		moduleGroup.CoverageNotes++
	}
}

func (grouper moduleGrouper) addCause(module string, cause *LedgerCause, key string) {
	grouper.group(module)
	entry, ok := grouper.causes[module][cause.RootCause]
	if !ok {
		entry = &LedgerModuleCause{RootCause: cause.RootCause, Known: cause.Known}
		grouper.causes[module][cause.RootCause] = entry
	}
	entry.Operations = append(entry.Operations, key)
}

func (grouper moduleGrouper) ordered() []LedgerModule {
	names := make([]string, 0, len(grouper.groups))
	for name := range grouper.groups {
		names = append(names, name)
	}
	sort.Slice(names, func(i, j int) bool {
		if (names[i] == "") != (names[j] == "") {
			return names[j] == ""
		}
		return names[i] < names[j]
	})
	modules := make([]LedgerModule, 0, len(names))
	for _, name := range names {
		modules = append(modules, grouper.finish(name))
	}
	return modules
}

func (grouper moduleGrouper) finish(name string) LedgerModule {
	moduleGroup := grouper.groups[name]
	causeNames := make([]string, 0, len(grouper.causes[name]))
	for causeName := range grouper.causes[name] {
		causeNames = append(causeNames, causeName)
	}
	sort.Strings(causeNames)
	for _, causeName := range causeNames {
		entry := grouper.causes[name][causeName]
		sort.Strings(entry.Operations)
		moduleGroup.Causes = append(moduleGroup.Causes, *entry)
		if !entry.Known {
			moduleGroup.NewCauses++
		}
	}
	return *moduleGroup
}

func isDiffering(classification string) bool {
	switch classification {
	case ClassificationDiffers, ClassificationMissingA, ClassificationMissingB:
		return true
	}
	return false
}

// finishRows orders the rows and counts what each classification means for
// the burn-down.
func (build *ledgerBuild) finishRows() ([]LedgerRow, LedgerTotals) {
	rows := make([]LedgerRow, 0, len(build.order))
	totals := LedgerTotals{}
	sort.Strings(build.order)
	for _, key := range build.order {
		row := build.rows[key]
		sort.Strings(row.RootCauses)
		row.Known = len(row.RootCauses) > 0 && allKnown(row.RootCauses, build.baseline)
		rows = append(rows, *row)
		switch row.Classification {
		case ClassificationDiffers, ClassificationMissingA, ClassificationMissingB:
			totals.Differing++
			totals.Probed++
		case ClassificationSkipped:
			totals.Skipped++
		case ClassificationNotProbed:
		default:
			totals.Probed++
		}
	}
	return rows, totals
}

// finishCauses orders the cause groups and splits them into known and new.
func (build *ledgerBuild) finishCauses(totals *LedgerTotals) []LedgerCause {
	names := make([]string, 0, len(build.causes))
	for name := range build.causes {
		names = append(names, name)
	}
	sort.Strings(names)
	causes := make([]LedgerCause, 0, len(names))
	for _, name := range names {
		group := build.causes[name]
		sort.Strings(group.Operations)
		causes = append(causes, *group)
		if group.Known {
			totals.KnownCauses++
			continue
		}
		totals.NewCauses++
	}
	return causes
}

func allKnown(causes []string, baseline map[string]bool) bool {
	for _, cause := range causes {
		if baseline[cause] || isAcceptedImprovement(cause) {
			continue
		}
		return false
	}
	return true
}

func contains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

// RootCause derives one finding's stable cause slug. Two findings share a
// slug when fixing one plausibly fixes the other: the 14 webhook rows of the
// 2026-09-05 run are one handled-refusal-degraded cause, and the five
// not-found regressions are one not-found-as-500.
//
// Entitled-pass findings (Case == entitledCaseName) get the SAME slug an
// identical finding would get from the main pass, prefixed with its own
// namespace: "entitled:" + the ordinary slug. Two findings only share one
// cause if fixing one plausibly fixes the other, and "the gate disagrees"
// and "behavior BEHIND the gate disagrees" are never the same fix, even when
// the underlying Kind and status pair are identical.
func RootCause(finding Finding) string {
	cause := rootCauseOf(finding)
	if finding.Case == entitledCaseName {
		return "entitled:" + cause
	}
	return cause
}

// skipCause names why an operation was not probed. The three are different
// jobs to burn down: a skip the run imposed on ITSELF to stay alive wants a
// sacrificial row of that kind, an asymmetric resolution wants the symbol
// table taught, and an unresolvable parameter wants an id to mint.
func skipCause(reason string) string {
	if isSelfDestructiveSkip(reason) {
		return "self-destructive-target"
	}
	if strings.Contains(reason, "resolvable on the") {
		return "harness-symbol-table"
	}
	return "unresolvable-parameter"
}

// rootCauseOf is RootCause without the entitled-pass namespace.
func rootCauseOf(finding Finding) string {
	before, after, hasStatus := statusPair(finding)
	switch finding.Kind {
	case FindingOperationMissing:
		return missingCause(finding)
	case FindingSkipped:
		return skipCause(finding.Reason)
	case FindingUnverifiedShape:
		return "unverified-list-shape"
	case FindingStatusDiff:
		if !hasStatus {
			return "status-class-mismatch"
		}
		return statusCause(before, after)
	case FindingPermissionDiff:
		if !hasStatus {
			return "permission-diff"
		}
		return withPair("permission-diff", before, after)
	case FindingPermissionLeak:
		return "permission-leak"
	case FindingMutationNotVisible:
		return "mutation-not-visible"
	case FindingBodyShapeDiff:
		return "body-shape-diff"
	case FindingBodyValueDiff:
		return "body-value-diff"
	case FindingErrorShapeDiff:
		return "error-shape-diff"
	case FindingErrorImproved:
		if !hasStatus {
			return "error-improved"
		}
		return withPair("error-improved", before, after)
	case FindingProbeFailed:
		return "probe-failed"
	default:
		return strings.ReplaceAll(finding.Kind, "_", "-")
	}
}

// missingCause names which side lost the operation.
func missingCause(finding Finding) string {
	presence, ok := finding.Fields["presence"]
	if ok {
		if after, _ := presence[1].(string); after == "absent" {
			return "operation-missing-on-candidate"
		}
		return "operation-missing-on-base"
	}
	return "operation-missing"
}

// statusCause names the shape of a status-class flip, always carrying the
// specific pair so two different flips never collapse into one cause.
func statusCause(before, after int) string {
	switch {
	case before == 404 && after >= 500:
		return withPair("not-found-as-500", before, after)
	case before >= 400 && before < 500 && after >= 500:
		return withPair("handled-refusal-degraded", before, after)
	case before >= 500 && after < 500:
		return withPair("server-error-resolved", before, after)
	case before >= 200 && before < 300 && after == 404:
		return withPair("route-absent-on-candidate", before, after)
	case after >= 200 && after < 300 && before == 404:
		return withPair("route-absent-on-base", before, after)
	default:
		return withPair("status-class-mismatch", before, after)
	}
}

func withPair(slug string, before, after int) string {
	return slug + ":" + strconv.Itoa(before) + "-" + strconv.Itoa(after)
}

// statusPair reads the [base, candidate] status pair off a finding.
func statusPair(finding Finding) (before, after int, ok bool) {
	pair, present := finding.Fields["status"]
	if !present {
		return 0, 0, false
	}
	before, okBefore := asInt(pair[0])
	after, okAfter := asInt(pair[1])
	return before, after, okBefore && okAfter
}

// asInt reads a status out of a field value, which is an int in memory and a
// json.Number or float64 after a round trip through the report file.
func asInt(value any) (int, bool) {
	switch typed := value.(type) {
	case int:
		return typed, true
	case int64:
		return int(typed), true
	case float64:
		return int(typed), true
	case json.Number:
		parsed, err := typed.Int64()
		return int(parsed), err == nil
	case string:
		parsed, err := strconv.Atoi(typed)
		return parsed, err == nil
	default:
		return 0, false
	}
}

// LoadCauseBaseline reads a set of known causes from a previous run's
// ledger.json, or from a plain JSON array of cause slugs.
func LoadCauseBaseline(path string) (map[string]bool, error) {
	data, err := os.ReadFile(path) // #nosec G304 -- operator-supplied baseline path
	if err != nil {
		return nil, fmt.Errorf("ledger baseline: %w", err)
	}
	known := map[string]bool{}
	var ledger Ledger
	if err := json.Unmarshal(data, &ledger); err == nil && len(ledger.Causes) > 0 {
		for _, cause := range ledger.Causes {
			known[cause.RootCause] = true
		}
		return known, nil
	}
	var slugs []string
	if err := json.Unmarshal(data, &slugs); err != nil {
		return nil, fmt.Errorf("ledger baseline %s: expected a ledger.json or a JSON array of cause slugs", path)
	}
	for _, slug := range slugs {
		known[slug] = true
	}
	return known, nil
}

// WriteLedger writes the ledger as indented JSON.
func WriteLedger(writer io.Writer, ledger Ledger) error {
	encoder := json.NewEncoder(writer)
	encoder.SetIndent("", "  ")
	return encoder.Encode(ledger)
}

// WriteCauseSummary renders the human head of the report: module -> cause
// -> operations, the modules with new work first, then the coverage notes,
// which are counted but never a cause.
func WriteCauseSummary(writer io.Writer, ledger Ledger) error {
	var output strings.Builder
	fmt.Fprintf(&output, "root causes: %d causes across %d operations (%d in the union, %d modules, %d operations in no module)\n",
		ledger.Totals.Causes, operationsWithCause(ledger.Operations), ledger.Totals.UnionOperations, ledger.Totals.Modules, ledger.Totals.Unmapped)
	if len(ledger.Scope) > 0 {
		fmt.Fprintf(&output, "scope: -module %s\n", strings.Join(ledger.Scope, " -module "))
	}
	if ledger.Totals.Causes == 0 {
		output.WriteString("  none\n")
	}
	quiet := 0
	ordered := modulesByWork(ledger.Modules)
	for index := range ordered {
		module := ordered[index]
		if len(module.Causes) == 0 {
			quiet++
			continue
		}
		writeModuleCauses(&output, module)
	}
	if quiet > 0 {
		fmt.Fprintf(&output, "%d modules with no cause\n", quiet)
	}
	writeCoverageNotes(&output, ledger)
	_, err := io.WriteString(writer, output.String())
	return err
}

func writeModuleCauses(output *strings.Builder, module LedgerModule) {
	fmt.Fprintf(output, "module %s: %d operations, %d differing, %d causes (%d new)\n",
		moduleLabel(module.Module), module.Operations, module.Differing, len(module.Causes), module.NewCauses)
	for _, cause := range module.Causes {
		marker := ""
		if cause.Known {
			marker = " [known]"
		}
		fmt.Fprintf(output, "  %s%s: %d operations\n", cause.RootCause, marker, len(cause.Operations))
		for _, operation := range cause.Operations {
			fmt.Fprintf(output, "    %s\n", operation)
		}
	}
}

func writeCoverageNotes(output *strings.Builder, ledger Ledger) {
	if len(ledger.CoverageNotes) == 0 {
		return
	}
	fmt.Fprintf(output, "coverage notes: %d operations the harness could not compare (never a cause, never fails the run)\n", ledger.Totals.CoverageNotes)
	for _, note := range ledger.CoverageNotes {
		fmt.Fprintf(output, "  %s: %d operations\n", note.Note, len(note.Operations))
	}
}

func moduleLabel(module string) string {
	if module == "" {
		return "(none)"
	}
	return module
}

func operationsWithCause(rows []LedgerRow) int {
	count := 0
	for index := range rows {
		if len(rows[index].RootCauses) > 0 {
			count++
		}
	}
	return count
}

// modulesByWork orders modules the way a burn-down is dispatched: new causes
// first, then the most differing operations, then by name.
func modulesByWork(modules []LedgerModule) []LedgerModule {
	ordered := make([]LedgerModule, len(modules))
	copy(ordered, modules)
	sort.SliceStable(ordered, func(i, j int) bool {
		if ordered[i].NewCauses != ordered[j].NewCauses {
			return ordered[i].NewCauses > ordered[j].NewCauses
		}
		if ordered[i].Differing != ordered[j].Differing {
			return ordered[i].Differing > ordered[j].Differing
		}
		return ordered[i].Module < ordered[j].Module
	})
	return ordered
}
