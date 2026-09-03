// Package toolmap holds the harness-independent tool-frame mapping helpers the
// coding-agent adapters share: output bounding, the CLI failure-document rule,
// the plan (todowrite) snapshot mapping, the measured X/Y progress mapper, and
// the per-turn tool-call de-dupe tracker. Both adapters (opencode and pi) map
// their own wire events onto internal/frames values through these helpers, so
// the tool cards, the plan checklist and the progress protocol behave the same
// whichever harness runs the turn.
package toolmap

import (
	"bytes"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/langwatch/langwatch/services/langyagent/internal/frames"
)

// The plan channel. `todowrite` is a first-class tool that rewrites the whole
// todo list per call; when one settles the manager mirrors its input as a typed
// plan frame (the panel's live checklist). Bounds keep a runaway list from
// flooding the wire, the plan is capped, and long item text truncated, never
// dropped.
const (
	todowriteToolName = "todowrite"
	// MaxPlanItems caps how many plan items one snapshot carries.
	MaxPlanItems = 30
	// MaxPlanContentChars caps one plan item's text, in runes.
	MaxPlanContentChars = 200
)

// IsTodoWriteTool reports whether a tool name is the plan tool.
func IsTodoWriteTool(name string) bool {
	return strings.EqualFold(name, todowriteToolName)
}

// truncatePlanContent caps one item's text at MaxPlanContentChars runes, marking
// an overflow with an ellipsis (truncate, never drop).
func truncatePlanContent(s string) string {
	r := []rune(s)
	if len(r) <= MaxPlanContentChars {
		return s
	}
	return string(r[:MaxPlanContentChars]) + "…"
}

// todoEntry is one row of a `todowrite` input, in either shape the tool emits.
type todoEntry struct {
	Content string `json:"content"`
	Status  string `json:"status"`
}

// PlanItemsFromInput derives the capped, truncated plan snapshot from a settled
// `todowrite` tool call's input. It tolerates the `{ "todos": [...] }` wrapper
// and a bare array, and reports ok=false when there is no non-empty item to
// carry (so a malformed/empty todowrite emits no plan frame, not an empty one).
func PlanItemsFromInput(raw json.RawMessage) ([]frames.PlanItem, bool) {
	raw = RawToolValue(raw)
	if len(raw) == 0 {
		return nil, false
	}
	var wrapper struct {
		Todos []todoEntry `json:"todos"`
	}
	var todos []todoEntry
	if err := json.Unmarshal(raw, &wrapper); err == nil && len(wrapper.Todos) > 0 {
		todos = wrapper.Todos
	} else {
		var arr []todoEntry
		if err := json.Unmarshal(raw, &arr); err != nil || len(arr) == 0 {
			return nil, false
		}
		todos = arr
	}
	items := make([]frames.PlanItem, 0, len(todos))
	for _, td := range todos {
		items = append(items, frames.PlanItem{Content: td.Content, Status: td.Status})
	}
	return BoundPlanItems(items)
}

// BoundPlanItems applies the plan bounds to an already-typed item list: blank
// items are dropped, item text is truncated at MaxPlanContentChars, and the
// list is capped at MaxPlanItems. Reports ok=false when nothing survives.
// PlanItemsFromInput routes through here; the pi adapter feeds its wire plan
// events through it directly.
func BoundPlanItems(items []frames.PlanItem) ([]frames.PlanItem, bool) {
	out := make([]frames.PlanItem, 0, len(items))
	for _, item := range items {
		content := strings.TrimSpace(item.Content)
		if content == "" {
			continue
		}
		out = append(out, frames.PlanItem{
			Content: truncatePlanContent(content),
			Status:  item.Status,
		})
		if len(out) >= MaxPlanItems {
			break
		}
	}
	if len(out) == 0 {
		return nil, false
	}
	return out, true
}

// The tools whose work happens outside the sandbox: the seven local mirrors run
// on the developer's own machine through the shared folder (ADR-129), and
// `code_access` and `question` speak to the person, not to the model. pi sends
// no title of its own, so the manager supplies one here and the panel's activity
// row can say where the call runs instead of showing a bare tool name.
var toolTitles = map[string]string{
	"code_access": "Code access",
	"question":    "Question",
	"local_read":  "Read on your machine",
	"local_write": "Write on your machine",
	"local_edit":  "Edit on your machine",
	"local_bash":  "Run on your machine",
	"local_grep":  "Search on your machine",
	"local_find":  "Find on your machine",
	"local_ls":    "List on your machine",
}

// ToolTitle returns the activity row label for a tool name, or "" when the tool
// has no title of ours (the card then falls back to the tool's own name).
func ToolTitle(name string) string {
	return toolTitles[strings.ToLower(strings.TrimSpace(name))]
}

// MaxToolOutputBytes caps a forwarded tool result. A tool can return megabytes
// (a big file read, a wide query); the card only ever shows a preview, so the
// stream must not carry the whole thing. Overflow is cut on a rune boundary and
// marked with a trailing ellipsis.
const MaxToolOutputBytes = 8 * 1024

// RawToolValue normalises an optional raw JSON field: an absent field and an
// explicit `null` both become nil, so the frame omits them rather than carrying
// a meaningless `"input":null`.
func RawToolValue(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 || bytes.Equal(raw, []byte("null")) {
		return nil
	}
	return raw
}

// HasToolInput reports whether a tool call's input actually tells us WHAT the
// call is doing, i.e. whether it carries any argument at all.
//
// `{}` is the case that matters and the one RawToolValue cannot see: it is a
// present, valid, entirely uninformative object. opencode really does emit a
// `running` transition whose input is still `{}` and then RE-SEND the same
// `running` once the arguments have materialized (the re-send is a known shape,
// see the tracker's dedupe). Treating that first empty `{}` as "we know the
// input" is what stranded every card: the start frame went out with no command,
// the tracker latched the call as started, and the re-send carrying the actual
// command was dropped as a duplicate. The command then existed nowhere on the
// wire, not on the start, not on the end, so the control plane could not
// re-type `bash("langwatch trace search")` into the capability it was, and the
// panel had nothing to label the card with but the tool's own name ("Bash…").
//
// So an empty object is NOT input. Waiting one more transition for the real
// thing is the whole difference between a card that says what it is doing and a
// card that says "Bash".
func HasToolInput(raw json.RawMessage) bool {
	raw = RawToolValue(raw)
	if len(raw) == 0 {
		return false
	}
	var probe map[string]json.RawMessage
	if err := json.Unmarshal(raw, &probe); err == nil {
		return len(probe) > 0
	}
	// A non-object input (tool input is typed loosely) is information.
	return true
}

// ToolTextFromRaw renders a raw tool result as the STRING the frame contract
// requires. A JSON string is unquoted to its value; any other JSON value (an
// object, an array, a number, tool output is typed loosely) is carried as its
// compact JSON text, which is exactly its marshaled form.
func ToolTextFromRaw(raw json.RawMessage) string {
	raw = RawToolValue(raw)
	if len(raw) == 0 {
		return ""
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return s
	}
	return string(raw)
}

// CarriesFailureDocument reports whether stdout holds the LangWatch CLI's own
// failure document, `{"ok": false, "error": {"code": …}}`.
//
// `ok: false` is the CLI's discriminant and no successful result carries it, so
// this asks the one question that matters and reads nothing else: is there
// structure here worth keeping in preference to the human summary? Anything it
// cannot parse is not a document, and the summary wins as before.
func CarriesFailureDocument(output string) bool {
	trimmed := strings.TrimSpace(output)
	if start := strings.IndexByte(trimmed, '{'); start > 0 {
		trimmed = trimmed[start:]
	}
	if !strings.HasPrefix(trimmed, "{") {
		return false
	}
	var doc struct {
		OK    *bool           `json:"ok"`
		Error json.RawMessage `json:"error"`
	}
	if err := json.Unmarshal([]byte(trimmed), &doc); err != nil {
		return false
	}
	return doc.OK != nil && !*doc.OK && len(doc.Error) > 0
}

// TruncateToolOutput caps a result at MaxToolOutputBytes so one huge tool
// return cannot bloat the stream, WITHOUT severing a JSON document mid-token.
//
// A blind byte cut was how every oversized `langwatch … --format json` result
// became an unreadable card: the CLI prints one JSON document to stdout, the cut
// left half a document, and everything downstream that parses it (the CLI
// envelope's card payload, the panel) got syntax garbage while the prose claimed
// success. So JSON output is reduced STRUCTURALLY under the cap, arrays
// capped, long strings clipped, and stays a valid document whatever its size;
// only non-JSON text falls back to the rune-boundary byte cut.
func TruncateToolOutput(s string) string {
	if len(s) <= MaxToolOutputBytes {
		return s
	}
	if reduced, ok := reduceJSONOutput(s); ok {
		return reduced
	}
	cut := MaxToolOutputBytes
	for cut > 0 && !utf8.RuneStart(s[cut]) {
		cut--
	}
	return s[:cut] + "…"
}

// reduceJSONOutput shrinks a JSON document under MaxToolOutputBytes by reducing
// its STRUCTURE, never by cutting bytes. Long strings are clipped (with an
// ellipsis), arrays keep a head of items, while every field name, count and
// scalar that fits survives, which is exactly what a result card needs (ids,
// totals, pagination) and what a byte cut destroys first. Tightens iteratively;
// reports ok=false when the input isn't a JSON document (or somehow still
// doesn't fit), so the caller falls back to the byte cut.
func reduceJSONOutput(s string) (string, bool) {
	// The document may sit behind console noise (the langwatch CLI prints an
	// ora spinner + "✔ Found N traces" line before its JSON): parse from the
	// first brace/bracket. The noise itself is dropped, every consumer of an
	// oversized result (the CLI envelope, the cards) wants the document.
	start := strings.IndexAny(s, "{[")
	if start < 0 {
		return "", false
	}
	var doc any
	if err := json.Unmarshal([]byte(strings.TrimSpace(s[start:])), &doc); err != nil {
		return "", false
	}
	// Successive budgets: generous first (keep list shape), brutal last.
	budgets := []struct {
		maxString int
		maxItems  int
	}{
		{maxString: 512, maxItems: 25},
		{maxString: 256, maxItems: 12},
		{maxString: 96, maxItems: 5},
		{maxString: 48, maxItems: 2},
	}
	for _, b := range budgets {
		reduced := reduceJSONValue(doc, b.maxString, b.maxItems)
		out, err := json.Marshal(reduced)
		if err != nil {
			return "", false
		}
		if len(out) <= MaxToolOutputBytes {
			return string(out), true
		}
	}
	return "", false
}

func reduceJSONValue(v any, maxString, maxItems int) any {
	switch value := v.(type) {
	case string:
		if len(value) > maxString {
			cut := maxString
			for cut > 0 && !utf8.RuneStart(value[cut]) {
				cut--
			}
			return value[:cut] + "…"
		}
		return value
	case []any:
		items := value
		clipped := false
		if len(items) > maxItems {
			items = items[:maxItems]
			clipped = true
		}
		out := make([]any, 0, len(items)+1)
		for _, item := range items {
			out = append(out, reduceJSONValue(item, maxString, maxItems))
		}
		if clipped {
			// An in-band, shape-preserving marker: cards render the head as the
			// sample it already is. The marker states the array's true size,
			// because a bare array has no count field of its own for a reader to
			// ride: the agent otherwise counts the marker as a row and reports
			// one more item than exists.
			out = append(out, fmt.Sprintf("… %d more items truncated, %d total", len(value)-maxItems, len(value)))
		}
		return out
	case map[string]any:
		// Width is capped like an array's length. Without this a document that
		// is one flat object of thousands of keys (a result keyed by id) can
		// never shrink under the budget however hard the loop tightens, so
		// reduceJSONOutput gives up and the caller severs the document with the
		// byte cut — the exact outcome this function exists to prevent.
		keys := make([]string, 0, len(value))
		for k := range value {
			keys = append(keys, k)
		}
		// Sorted so the SAME document always reduces to the same keys; Go's map
		// order would otherwise make the card's contents a coin toss.
		sort.Strings(keys)
		dropped := 0
		if len(keys) > maxItems {
			dropped = len(keys) - maxItems
			keys = keys[:maxItems]
		}
		out := make(map[string]any, len(keys)+1)
		for _, k := range keys {
			out[k] = reduceJSONValue(value[k], maxString, maxItems)
		}
		if dropped > 0 {
			out["…"] = fmt.Sprintf("%d more keys truncated", dropped)
		}
		return out
	default:
		return v
	}
}

// ToolCallTracker de-dupes the tool lifecycle across re-delivered call updates:
// a call's state can land on the stream many times (opencode re-publishes a
// tool part on every state transition; a wire protocol can re-send an event).
// The tracker holds the per-turn set of ids it has already opened and closed,
// which is what guarantees EXACTLY one `start` and one `end` per call. Scoped
// to a single turn's stream, one turn, one tracker, no cross-turn leak.
//
// It also owns the measured X/Y progress state (see MeasuredProgressFromPlan):
// the per-label observed counts, and the duration of the last settled non-plan
// tool call, which is the batch timing a progress sample carries.
type ToolCallTracker struct {
	started         map[string]struct{}
	ended           map[string]struct{}
	startedAt       map[string]time.Time
	progressCurrent map[string]int64
	lastWorkMs      int64
	now             func() time.Time
}

// NewToolCallTracker returns a tracker on the real clock.
func NewToolCallTracker() *ToolCallTracker {
	return NewToolCallTrackerWithClock(time.Now)
}

// NewToolCallTrackerWithClock returns a tracker on an injected clock (tests).
func NewToolCallTrackerWithClock(now func() time.Time) *ToolCallTracker {
	return &ToolCallTracker{
		started:         map[string]struct{}{},
		ended:           map[string]struct{}{},
		startedAt:       map[string]time.Time{},
		progressCurrent: map[string]int64{},
		now:             now,
	}
}

// StartIfNew marks id as started and reports whether this is the FIRST time,
// the caller emits the start frame exactly when it answers true. The start
// instant is recorded so the settle can measure the call's work time.
func (t *ToolCallTracker) StartIfNew(id string) bool {
	if _, seen := t.started[id]; seen {
		return false
	}
	t.started[id] = struct{}{}
	t.startedAt[id] = t.now()
	return true
}

// EndIfNew marks id as settled and reports whether this is the FIRST settle,
// the caller emits the end frame exactly when it answers true. A settled
// non-plan call updates the last-work duration the progress mapper reads
// (todowrite is bookkeeping, not work, so it never contributes timing).
func (t *ToolCallTracker) EndIfNew(id, toolName string) bool {
	if _, seen := t.ended[id]; seen {
		return false
	}
	t.ended[id] = struct{}{}
	if startedAt, ok := t.startedAt[id]; ok && !IsTodoWriteTool(toolName) {
		if elapsed := t.now().Sub(startedAt).Milliseconds(); elapsed > 0 {
			t.lastWorkMs = elapsed
		}
	}
	return true
}

// The separator must be a SPACED dash. AGENTS.md teaches the model exactly one
// example of this format, so that example and this pattern are one contract:
// change either and progress silently stops being drawn, because a todo line
// that does not match is simply carried as prose. A colon is the near miss to
// watch for; it produces no measured frame at all.
var measuredProgressPattern = regexp.MustCompile(`^\s*(.+?)\s+[-–—]\s+([0-9][0-9,]*)\s*/\s*([0-9][0-9,]*)\s*$`)

// MeasuredProgressFromPlan recognizes the exact X/Y todo protocol documented in
// AGENTS.md. The model owns the label and observed counts; the manager owns the
// timing. Keeping the conversion here makes progress a typed frame instead of
// prose parsing in the browser, and works for every batched tool/resource.
func (t *ToolCallTracker) MeasuredProgressFromPlan(items []frames.PlanItem) (frames.Frame, bool) {
	for _, item := range items {
		status := strings.ToLower(strings.TrimSpace(item.Status))
		if status != "in_progress" && status != "completed" {
			continue
		}
		match := measuredProgressPattern.FindStringSubmatch(strings.TrimSpace(item.Content))
		if len(match) != 4 {
			continue
		}
		parseCount := func(raw string) (int64, error) {
			return strconv.ParseInt(strings.ReplaceAll(raw, ",", ""), 10, 64)
		}
		current, currentErr := parseCount(match[2])
		total, totalErr := parseCount(match[3])
		if currentErr != nil || totalErr != nil || total <= 0 || current < 0 || current > total {
			continue
		}

		key := strings.ToLower(strings.TrimSpace(match[1]))
		previous := t.progressCurrent[key]
		batchItems := current - previous
		if batchItems < 0 {
			batchItems = 0
		}
		t.progressCurrent[key] = current

		frame, err := frames.MeasuredProgress(
			strings.TrimSpace(item.Content),
			current,
			total,
			batchItems,
			t.lastWorkMs,
		)
		return frame, err == nil
	}
	return frames.Frame{}, false
}
