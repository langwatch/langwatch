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
}

// KindSummary is one traffic kind: sent, answered 2xx, failed, and for writes how many are visible after settle.
type KindSummary struct {
	Kind       string `json:"kind"`
	Sent       int    `json:"sent"`
	OK         int    `json:"ok"`
	Failed     int    `json:"failed"`
	Write      bool   `json:"write"`
	Visible    int    `json:"visible"`
	Lost       int    `json:"lost"` // answered 2xx, never visible
	MaxLatency int64  `json:"maxLatencyMs"`
	FirstError string `json:"firstError,omitempty"`
}

// PhaseStatuses counts each status code per api phase, every kind together.
type PhaseStatuses struct {
	Phase    string         `json:"phase"`
	Statuses map[string]int `json:"statuses"`
}

// QueueSummary is the waiting work: its peak and how long it took to drain once head's worker started.
type QueueSummary struct {
	Samples   []QueueSample `json:"samples"`
	Baseline  int           `json:"baseline"`
	Peak      int           `json:"peak"`
	PeakAtMs  int64         `json:"peakAtMs"`
	DrainedMs int64         `json:"drainedAfterWorkerMs"` // -1: never drained
	TopKeys   string        `json:"topKeysAtEnd"`
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
	"I0":  "api holds (holding page, then upgrading mode) until the ledger is current",
	"I2":  "ledger current: every step done or not-needed (operator steps aside)",
	"I2b": "nothing reopened after ready",
	"I3":  "api ready and every live roster row declares the image's steps",
	"I4":  "copy never move: no table lost rows across the upgrade",
	"I6":  "seeded product kinds read back through head",
	"I8":  "a second upgrade exits 0 and changes no ledger row",
	"I9":  "no error lines in head's api and worker logs",
	"N1":  "head api answers ingest before the upgrade is done",
	"N2":  "no failed call through the switch (held then answered counts)",
	"N3":  "no lost write: every 2xx write visible after settle",
	"N4":  "queued work drains once head's worker runs",
	"O1":  "Ops > Upgrades shows the right state",
}

// Summarize folds the calls by kind and by phase; visible holds each write id seen after settle.
func Summarize(calls []Call, timeline []PhaseChange, visible map[string]bool) ([]KindSummary, []PhaseStatuses) {
	kinds := map[string]*KindSummary{}
	phases := map[string]map[string]int{}
	var order []string
	for _, call := range calls {
		summary := kinds[call.Kind]
		if summary == nil {
			summary = &KindSummary{Kind: call.Kind, Write: call.Write}
			kinds[call.Kind] = summary
		}
		summary.add(call, visible)
		phase := PhaseAt(timeline, call.AtMs)
		if phases[phase] == nil {
			phases[phase] = map[string]int{}
			order = append(order, phase)
		}
		phases[phase][statusName(call)]++
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
	if !call.ok() {
		summary.Failed++
		summary.FirstError = firstOf(summary.FirstError, fmt.Sprintf("%s at %d ms: %.200s", statusName(call), call.AtMs, call.Error))
		return
	}
	summary.OK++
	if !call.Write {
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
	fmt.Fprintf(&text, "# upgradelab cell %s\n\n%s x %s x %s, from %s to %s, started %s\n\n", report.Cell, report.Deployment, report.Tier, report.Shape, report.Release, report.Head, report.Started)
	if report.Error != "" {
		fmt.Fprintf(&text, "**Stopped:** %s\n\n", report.Error)
	}
	text.WriteString("| Invariant | Name | Result | Detail |\n| --- | --- | --- | --- |\n")
	for _, each := range report.Verdicts {
		fmt.Fprintf(&text, "| %s | %s | %s | %s |\n", each.ID, each.Name, each.Result, strings.ReplaceAll(each.Detail, "|", "/"))
	}
	text.WriteString("\n| Kind | Sent | 2xx | Failed | Visible | Lost | Max latency ms |\n| --- | --- | --- | --- | --- | --- | --- |\n")
	for _, each := range report.Traffic {
		fmt.Fprintf(&text, "| %s | %d | %d | %d | %s | %s | %d |\n", each.Kind, each.Sent, each.OK, each.Failed, writeCell(each, each.Visible), writeCell(each, each.Lost), each.MaxLatency)
	}
	report.writeTimeline(&text)
	fmt.Fprintf(&text, "\nMarks (ms from start): %v\n\nQueue: baseline %d, peak %d at %d ms, drained %d ms after head's worker started\n\n",
		report.Marks, report.Queue.Baseline, report.Queue.Peak, report.Queue.PeakAtMs, report.Queue.DrainedMs)
	for _, shot := range report.Shots {
		fmt.Fprintf(&text, "- shot %s at %d ms: %s state %q %s\n", shot.Phase, shot.AtMs, shot.File, shot.State, shot.Error)
	}
	for _, each := range report.Traffic {
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

func writeCell(summary KindSummary, value int) string {
	if !summary.Write {
		return "-"
	}
	return fmt.Sprint(value)
}
