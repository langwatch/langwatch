package cell

import (
	"fmt"
	"maps"
	"slices"
	"strings"
)

// Report is one cell's result: timings, the api's phases, every invariant and the traffic it carried.
type Report struct {
	Cell       string           `json:"cell"`
	Deployment string           `json:"deployment"`
	Tier       string           `json:"tier"`
	Shape      string           `json:"shape"`
	Release    string           `json:"release"`
	Head       string           `json:"head"`
	HeadCommit string           `json:"headCommit"` // the commit head ran, plus its local changes
	Started    string           `json:"started"`
	Error      string           `json:"error,omitempty"`
	Timings    []Timing         `json:"timings"`
	Marks      map[string]int64 `json:"marks"`
	Phases     []PhaseChange    `json:"phases"`
	Verdicts   []Verdict        `json:"verdicts"`
	Traffic    []KindSummary    `json:"traffic"`
	Timeline   []PhaseStatuses  `json:"statusTimeline"`
	Queue      QueueSummary     `json:"queue"`
	Shots      []Shot           `json:"shots"`
	Notes      []string         `json:"notes,omitempty"`
	Resources  []ResourcePeak   `json:"resources,omitempty"`
	Ribbon     string           `json:"ribbon,omitempty"`
}

// Timing is how long one harness step took.
type Timing struct {
	Step string `json:"step"`
	Ms   int64  `json:"ms"`
}

// Verdict is one invariant's result: pass, fail or inconclusive (never a silent pass).
type Verdict struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Result string `json:"result"`
	Detail string `json:"detail"`
	// Scenarios are the soak scenario ids (specs/upgrade/upgrade-soak-rounds.feature) this check judges.
	Scenarios []string `json:"scenarios,omitempty"`
}

// KindSummary is one traffic kind: sent, answered 2xx, failed, and for writes how many are visible after settle.
type KindSummary struct {
	Kind       string `json:"kind"`
	Sent       int    `json:"sent"`
	OK         int    `json:"ok"`
	Failed     int    `json:"failed"`
	Write      bool   `json:"write"`
	Visible    int    `json:"visible"`
	Lost       int    `json:"lost"`                // answered 2xx, never visible
	Unchecked  bool   `json:"unchecked,omitempty"` // a stopped cell never asked the stores, so Visible and Lost mean nothing
	MaxLatency int64  `json:"maxLatencyMs"`
	FirstError string `json:"firstError,omitempty"`
	// Upgrade-in-progress answers retried, the longest retry window, and every non-2xx seen on any attempt.
	UpgradeInProgress int   `json:"upgradeInProgress"`
	Retries           int   `json:"retries"`
	MaxRetryWindowMs  int64 `json:"maxRetryWindowMs"`
	NonOK             int   `json:"nonOk"`
}

// PhaseStatuses counts each status code per api phase, every kind together.
type PhaseStatuses struct {
	Phase    string         `json:"phase"`
	Statuses map[string]int `json:"statuses"`
}

// QueueSummary is the group queues' waiting jobs over the run and when they fell back around the baseline.
type QueueSummary struct {
	Samples     []QueueSample `json:"samples"`
	Baseline    int           `json:"baseline"`   // steady-state depth: 0, the pre-cut depth is the backlog
	Limit       int           `json:"drainLimit"` // "around the baseline": drainLimit(Baseline)
	AtCut       int           `json:"depthAtCut"` // -1: unread
	Peak        int           `json:"peak"`
	PeakAtMs    int64         `json:"peakAtMs"`
	DrainedMs   int64         `json:"drainedAfterWorkerMs"` // -1: never within the limit and staying
	SlopePerMin float64       `json:"slopeLast10MinPerMin"`
	Final       int           `json:"finalDepth"`  // -1: no reading
	FinalNotDue int           `json:"finalNotDue"` // jobs scheduled later at the last reading, left out of Final
	ReadErrors  int           `json:"readErrors"`
	FirstError  string        `json:"firstReadError,omitempty"`
	ByQueue     string        `json:"byQueueAtEnd"`
	ByKind      string        `json:"byKindAtEnd"` // waiting group-queue jobs per job kind, with when they are due
}

// Shot is one screenshot and the Upgrades page state it showed.
type Shot struct {
	Phase string `json:"phase"`
	AtMs  int64  `json:"atMs"`
	File  string `json:"file"`
	URL   string `json:"url"`
	State string `json:"state"`
	Error string `json:"error,omitempty"`
}

func verdict(id string, pass bool, detail string) Verdict {
	result := "fail"
	if pass {
		result = "pass"
	}
	return Verdict{ID: id, Name: invariantNames[id], Result: result, Detail: detail}
}

// invariantNames are the plan's I-ids plus the cell's own (N: nothing dropped, O: Ops page, H: hybrid).
var invariantNames = map[string]string{
	"H1":  "each tenant's telemetry and projections land only on its own target",
	"H2":  "the upgrade applied every ClickHouse target and the ledger shows each",
	"I0":  "the api serves everything from boot while the upgrade runs: no holding page",
	"B1":  "no browser console error and no failed request during the walk",
	"I7":  "every stored event parses under head's schemas and upcasts",
	"I5":  "read models are filled: trace meter equals this month's trace count, open suite runs counted",
	"I2":  "ledger current: every step done or not-needed (operator steps aside)",
	"I2b": "nothing reopened after ready",
	"I3":  "api ready and every live roster row declares the image's steps",
	"I4":  "copy never move: no table lost rows across the upgrade",
	"I6":  "seeded product kinds read back through head",
	"I8":  "a second upgrade exits 0 and changes no ledger row",
	"I9":  "no error lines in head's api and worker logs",
	"N2":  "every call eventually succeeds (upgrade_in_progress retried per Retry-After)",
	"N1":  "head's api answers before the upgrade is done",
	"N7":  "head's api started before its worker never exits before ready (restarts counted)",
	"N6":  "no call went unanswered (refused, reset, or no release behind the balancer)",
	"N5":  "ingest never answers a non-2xx, on any attempt",
	"N3":  "no lost write: every 2xx write visible after settle",
	"N4":  "queued work drains once head's worker runs",
	"O1":  "Ops > Upgrades shows the right state",
	"P1":  "the first sign-up of an empty self-hosted install operates; no later sign-up does",
	"H3":  "a private organization reads its traces list, a trace, analytics, a logged evaluation and a dataset's rows through head",
	"H6":  "every private kind (spans, traces, logs, metrics, evaluations, events) sits on the organization's own target",
	"H7":  "a private organization whose route is missing or malformed is refused clearly, never served from the shared target",
	"H8":  "a private target down during the upgrade holds only that organization; the rest finish and it catches up when back",
	"H9":  "Ops > Upgrades shows a Dataplanes tab naming every private target",
	"H4":  "objects land only in their tenant's S3: the private bucket holds the private project's, the shared none of them",
	"H5":  "the shared tenant cannot read the private tenant's trace or dataset",
	"D1":  "api before worker: a read meets 503 upgrade_in_progress with Retry-After and succeeds on retry",
	"D2":  "head's worker killed mid-upgrade and restarted: the upgrade still completes",
	"D3":  "a failed background step retried from Ops > Upgrades runs again to done",
	"E1":  "the license carries over: licensing:copy-organization-licenses settled and every licensed organization keeps its key",
	"E2":  "SSO sign-in works before, during and after the switch",
	"E3":  "SCIM pushed mid-upgrade lands once",
	"E4":  "custom roles and grants behave as on main: a key with no grant is refused",
	"E6":  "a plain member signs in through the deployment's SSO on main and again on head after the migrations; main's cookie reads cleanly",
	"E7":  "a plain member signs in through their organization's own SSO connection before and after the upgrade",
	"E8":  "a member who signed in through main's deployment-wide Auth0 signs in on head through it: same organization, same role, API keys answer",
	"E9":  "a member signs in through their organization's own SAML connection before and after the upgrade",
	"E10": "the seed account signs in with its password on head beside both SSO doors: same organization and role",
	"E12": "email/password stays closed on a licensed SSO install: a password on an address an ACTIVE connection governs opens no session on head",
	"E13": "a custom role made on main keeps its permissions and bindings on head",
	"E14": "SCIM: users and a group provisioned on main keep their membership on head through main's token, and a push on head lands",
	"E11": "an organization on main's old per-organization SSO (legacy columns, no connection) is grandfathered onto a connection, its member signs in on head and Ops shows the migration inventory",
	"E15": "the mixed legacy-SSO organization's administrator sees the hint to move its legacy domain in SSO settings",
	"A1":  "tenant oddities: the held organization stays held alone and Ops > Upgrades > Organizations names it (Home's Action needed card is for operator steps, not held organizations)",
	"A2":  "tenant oddities: plaintext provider keys are sealed and still read through head",
	"A3":  "tenant oddities: dataset rows main kept in Postgres are kept and read through head",
	"A4":  "tenant oddities: an organization with prompts and no tags gets its tags and its prompt still opens",
	"Q1":  "queued-jobs-v1: every job main queued before the switch, in main's format, ran on head's worker or was left safely (none still due in its group, none dead-lettered, none blocked)",
	"V1":  "upcast-events: every stored type head reads through an upcast is settled in its ledger, main's rows under it are kept, and I7 refused none",
	"F1":  "empty origin: every data step ends done over zero rows (or not-needed)",
	"F3":  "empty origin: an organization made just after ready keeps its founder (membership and role bindings) after settle",
	"R2":  "the oldest aged trace each organization keeps reads back through head's API",
	"R1":  "aged data: no organization's age slice loses rows across the upgrade beyond what main's own retention TTL expires",
	"E5":  "the seed account is a platform operator after the upgrade (ADMIN_EMAILS set, or the sole-organization bootstrap)",
	"U1":  "the holding and upgrading pages are branded, centered and say what is happening (Haiku reads the shots)",
	"U2":  "every command of docs/self-hosting/upgrade.mdx ran as written and exited 0",
	"U3":  "Ops > Upgrades explains a held tenant and a failed step, and Retry fixes the failed one",
	"U4":  "an operator can tell from the panel alone when it is safe to stop the old release (Haiku reads the shots)",
	"U5":  "compose up with the new image needed no step the guide omits",
	"U6":  "helm upgrade rolled with no unanswered probe",
}

// scenarioIDs maps each check to the soak scenarios it judges (plan section 8.3, "Judged by").
var scenarioIDs = map[string][]string{
	"N1": {"S1"}, "N6": {"S1"}, "N7": {"S1"}, "N5": {"S2"}, "N2": {"S3"}, "D1": {"S3"}, "N3": {"S4"}, "N4": {"S5"},
	"I0": {"S6"}, "I2": {"S7", "F1"}, "I2b": {"S7"}, "I4": {"S8"}, "I6": {"S9"}, "I5": {"S10"}, "I7": {"S14"}, "I9": {"S11"}, "B1": {"S11"},
	"O1": {"S12"}, "I8": {"S13", "F2"}, "D3": {"U3"},
	"H1": {"H1"}, "H2": {"H2"}, "H3": {"H3"}, "H4": {"H4"}, "H5": {"H5"}, "H6": {"H6"}, "H7": {"H7"}, "H8": {"H8"}, "H9": {"H9"},
	"E1": {"E1"}, "E2": {"E2"}, "E3": {"E3"}, "E4": {"E4"}, "E5": {"E5"}, "E6": {"E6"}, "E7": {"E7"}, "E12": {"E12"}, "E13": {"E13"}, "E14": {"E14"},
	"U1": {"U1"}, "U2": {"U2"}, "U3": {"U3"}, "U4": {"U4"}, "U5": {"U5"}, "U6": {"U6"},
}

// Summarize folds the calls by kind and by phase; visible holds each write id seen after settle.
func Summarize(calls []Call, timeline []PhaseChange, visible map[string]bool) ([]KindSummary, []PhaseStatuses) {
	kinds := map[string]*KindSummary{}
	phases := map[string]map[string]int{}
	var order []string
	for i := range calls {
		call := &calls[i]
		summary := kinds[call.Kind]
		if summary == nil {
			summary = &KindSummary{Kind: call.Kind, Write: call.Write, Unchecked: visible == nil}
			kinds[call.Kind] = summary
		}
		summary.add(*call, visible)
		phase := PhaseAt(timeline, call.AtMs)
		if phases[phase] == nil {
			phases[phase] = map[string]int{}
			order = append(order, phase)
		}
		phases[phase][statusName(*call)]++
	}
	var summaries []KindSummary
	for _, name := range slices.Sorted(maps.Keys(kinds)) {
		summaries = append(summaries, *kinds[name])
	}
	var statuses []PhaseStatuses
	for _, phase := range order {
		statuses = append(statuses, PhaseStatuses{Phase: phase, Statuses: phases[phase]})
	}
	return summaries, statuses
}

func (summary *KindSummary) add(call Call, visible map[string]bool) {
	summary.Sent++
	summary.MaxLatency = max(summary.MaxLatency, call.Latency)
	summary.UpgradeInProgress += call.UpgradeInProgress
	summary.Retries += call.Retries
	summary.MaxRetryWindowMs = max(summary.MaxRetryWindowMs, call.RetryWindowMs)
	summary.NonOK += call.NonOK
	if call.Status == 0 {
		summary.NonOK++
	}
	if !call.ok() {
		summary.Failed++
		summary.FirstError = firstOf(summary.FirstError, fmt.Sprintf("%s at %d ms: %.200s", statusName(call), call.AtMs, call.Error))
		return
	}
	summary.OK++
	if !call.Write || visible == nil {
		return
	}
	if visible[call.Kind+"/"+call.ID] {
		summary.Visible++
	} else {
		summary.Lost++
	}
}

func statusName(call Call) string {
	if call.Status == 0 {
		return "no-answer"
	}
	return fmt.Sprint(call.Status)
}

// Markdown is the cell's result table and the traffic behind it.
func (report *Report) Markdown() string {
	var text strings.Builder
	fmt.Fprintf(&text, "# upgradelab cell %s\n\n%s x %s x %s, from %s to %s, started %s\n\n", report.Cell, report.Deployment, report.Tier, report.Shape, report.Release, report.HeadCommit, report.Started)
	if report.Error != "" {
		fmt.Fprintf(&text, "**Stopped:** %s\n\n", report.Error)
	}
	text.WriteString("| Invariant | Scenarios | Name | Result | Detail |\n| --- | --- | --- | --- | --- |\n")
	for _, each := range report.Verdicts {
		fmt.Fprintf(&text, "| %s | %s | %s | %s | %s |\n", each.ID, strings.Join(each.Scenarios, ", "), each.Name, each.Result, strings.ReplaceAll(each.Detail, "|", "/"))
	}
	text.WriteString("\n| Kind | Sent | 2xx (final) | Failed | Visible | Lost | Non-2xx seen | upgrade_in_progress | Retries | Max retry window ms | Max latency ms |\n|" + strings.Repeat(" --- |", 11) + "\n")
	for i := range report.Traffic {
		each := &report.Traffic[i]
		fmt.Fprintf(&text, "| %s | %d | %d | %d | %s | %s | %d | %d | %d | %d | %d |\n", each.Kind, each.Sent, each.OK, each.Failed,
			writeCell(*each, each.Visible), writeCell(*each, each.Lost), each.NonOK, each.UpgradeInProgress, each.Retries, each.MaxRetryWindowMs, each.MaxLatency)
	}
	report.writeTimeline(&text)
	if report.Ribbon != "" {
		fmt.Fprintf(&text, "\nTimeline ribbon (ms from start):\n\n%s", report.Ribbon)
	}
	if len(report.Resources) > 0 {
		text.WriteString("\n| Peak resource | RSS MiB | CPU % | Bytes MiB |\n| --- | --- | --- | --- |\n")
		for _, peak := range report.Resources {
			text.WriteString(peak.String() + "\n")
		}
	}
	fmt.Fprintf(&text, "\nMarks (ms from start): %v\n\n", report.Marks)
	report.Queue.write(&text)
	for _, shot := range report.Shots {
		fmt.Fprintf(&text, "- shot %s at %d ms: %s state %q %s\n", shot.Phase, shot.AtMs, shot.File, shot.State, shot.Error)
	}
	for i := range report.Traffic {
		each := &report.Traffic[i]
		if each.FirstError != "" {
			fmt.Fprintf(&text, "- first failure %s: %s\n", each.Kind, strings.ReplaceAll(each.FirstError, "\n", " "))
		}
	}
	for _, note := range report.Notes {
		fmt.Fprintf(&text, "- note: %s\n", note)
	}
	return text.String()
}

func (report *Report) writeTimeline(text *strings.Builder) {
	text.WriteString("\n| Api phase | From ms |\n| --- | --- |\n")
	for _, each := range report.Phases {
		fmt.Fprintf(text, "| %s | %d |\n", each.Phase, each.AtMs)
	}
	text.WriteString("\n| Phase | Statuses |\n| --- | --- |\n")
	for _, each := range report.Timeline {
		fmt.Fprintf(text, "| %s | %v |\n", each.Phase, each.Statuses)
	}
	text.WriteString("\n| Step | Ms |\n| --- | --- |\n")
	for _, each := range report.Timings {
		fmt.Fprintf(text, "| %s | %d |\n", each.Step, each.Ms)
	}
}

// write renders the backlog: its figures, a sampled table over time and what waited at the end.
func (queue QueueSummary) write(text *strings.Builder) {
	fmt.Fprintf(text, "Queue (group-queue jobs): baseline %d, limit %d, at the cut %d, peak %d at %d ms, at baseline and staying %d ms after head's worker started, %d at the end, slope %.1f jobs/min over the last 10 min; %d failed reads\n\n",
		queue.Baseline, queue.Limit, queue.AtCut, queue.Peak, queue.PeakAtMs, queue.DrainedMs, queue.Final, queue.SlopePerMin, queue.ReadErrors)
	if rows := queueRows(queue.Samples, queueTableRows); len(rows) > 0 {
		text.WriteString("| Ms from start | Waiting jobs |\n| --- | --- |\n")
		for _, sample := range rows {
			fmt.Fprintf(text, "| %d | %d |\n", sample.AtMs, sample.Depth)
		}
		text.WriteString("\n")
	}
	if queue.ByQueue != "" {
		fmt.Fprintf(text, "Waiting at the end, by queue:\n\n```\n%s\n```\n\n", queue.ByQueue)
	}
	if queue.ByKind != "" {
		fmt.Fprintf(text, "Waiting at the end, by job kind:\n\n```\n%s\n```\n\n", queue.ByKind)
	}
}

const queueTableRows = 24

// queueRows thins samples to about limit evenly spaced rows, always keeping the peak and the last.
func queueRows(samples []QueueSample, limit int) []QueueSample {
	if len(samples) <= limit {
		return samples
	}
	peak := 0
	for i, sample := range samples {
		if sample.Depth > samples[peak].Depth {
			peak = i
		}
	}
	var rows []QueueSample
	step := float64(len(samples)-1) / float64(limit-1)
	for row, next := 0, 0; row < limit; row++ {
		at := int(float64(row)*step + 0.5)
		for ; next <= at; next++ {
			if next == peak && next != at {
				rows = append(rows, samples[next])
			}
		}
		rows = append(rows, samples[at])
	}
	return rows
}

func writeCell(summary KindSummary, value int) string {
	if !summary.Write {
		return "-"
	}
	if summary.Unchecked {
		return "unchecked"
	}
	return fmt.Sprint(value)
}
