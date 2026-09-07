// Package logfmt renders one captured log line for a person to read.
//
// Every supervised child writes the same structured JSON on stdout, in every
// environment (dev/docs/best_practices/dev-log-format.md). That is what
// production ships to Loki, and it is unreadable in a terminal — so the
// rendering lives here, in the one place `haven logs`, `haven logs -t`, the
// attached `up` viewer and the supervisor's live echo all go through, rather
// than in eight children each inventing a pretty console of its own.
//
// A line that is not that JSON (a Node stack frame, a Vite banner, a lane
// wrapper's "exited — restarting in 1s") is passed through under the same lane
// column, so a mixed stream still lines up.
package logfmt

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Column widths. The lane column is 9 wide, fitting every lane name except
// "design-system" (13 chars) — pad() leaves a name that long unpadded rather
// than truncated, so it never loses a character, only the alignment on that
// one lane's lines. The level column fits the longest level word ("error").
// Both are fixed so the message starts at the same offset on every line of
// every lane — which is the whole point of rendering centrally.
const (
	LaneWidth  = 9
	LevelWidth = 5
	// TimeLayout is the clock a person reads: local wall time to the
	// millisecond. The captured record keeps the full RFC 3339 UTC instant.
	TimeLayout = "15:04:05.000"
)

// stackIndent is what a multi-line stack trace is inset by, so it reads as
// continuation of the line above rather than as more lines.
const stackIndent = "    "

// Level is the normalized severity of a line.
type Level string

// The severities a rendered line can carry. LevelNone is a line that named
// none — a passthrough, or a record whose level word nothing recognized.
const (
	LevelNone  Level = ""
	LevelTrace Level = "trace"
	LevelDebug Level = "debug"
	LevelInfo  Level = "info"
	LevelWarn  Level = "warn"
	LevelError Level = "error"
	LevelFatal Level = "fatal"
)

// Options is everything the renderer needs that is not in the line itself.
type Options struct {
	// Lane is the supervised child's name, shown in the lane column.
	Lane string
	// LaneColor is the SGR parameter for the lane column (app/plan.go's
	// palette). Empty renders the lane unpainted.
	LaneColor string
	// Time is the instant the line was captured, used when the payload
	// carries no timestamp of its own. Zero prints an empty time column.
	Time time.Time
	// Color enables SGR sequences. Callers turn it off for a pipe, for
	// NO_COLOR, and for --agent.
	Color bool
}

// Record is one parsed structured line.
type Record struct {
	Time    time.Time
	HasTime bool
	Level   Level
	Message string
	Stack   string
	Fields  []Field
}

// Field is one rendered key/value pair, already stringified.
type Field struct {
	Key   string
	Value string
}

// timeKeys, levelKeys and messageKeys are the spellings accepted on the way
// in. The shared format writes the first of each; the others are what older
// captures and un-migrated libraries wrote, and a renderer that refused them
// would show a wall of raw JSON for every log file already on disk.
var (
	timeKeys    = []string{"time", "ts", "timestamp"}
	levelKeys   = []string{"level", "severity"}
	messageKeys = []string{"msg", "message"}
	stackKeys   = []string{"stack", "stacktrace"}
)

// droppedFields are constant for the life of a process, so they say nothing a
// terminal line needs: the lane column already names the service, and pid and
// hostname are the same on every line of it.
var droppedFields = map[string]bool{
	"pid": true, "hostname": true, "service": true, "version": true,
	"env": true, "service.version": true, "v": true,
}

// numericLevels maps pino's default numeric levels onto the words.
var numericLevels = map[int]Level{
	10: LevelTrace, 20: LevelDebug, 30: LevelInfo,
	40: LevelWarn, 50: LevelError, 60: LevelFatal,
}

// Parse reads one line as the shared structured format. ok is false for
// anything that is not a JSON object — those lines are passed through.
func Parse(line string) (Record, bool) {
	trimmed := strings.TrimSpace(line)
	if !strings.HasPrefix(trimmed, "{") || !strings.HasSuffix(trimmed, "}") {
		return Record{}, false
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal([]byte(trimmed), &raw); err != nil {
		return Record{}, false
	}
	rec := Record{}
	used := map[string]bool{}
	if at, key, ok := parseTime(raw); ok {
		rec.Time, rec.HasTime, used[key] = at, true, true
	}
	if level, key, ok := parseLevel(raw); ok {
		rec.Level, used[key] = level, true
	}
	if msg, key, ok := firstString(raw, messageKeys); ok {
		rec.Message, used[key] = msg, true
	}
	if stack, key, ok := firstString(raw, stackKeys); ok {
		rec.Stack, used[key] = stack, true
	}
	// A record with neither a message nor a level is some other tool's JSON
	// (a Vite manifest dump, a `pnpm --json` result). Passing it through
	// unchanged is more honest than rendering it as an empty log line.
	if rec.Message == "" && rec.Level == LevelNone {
		return Record{}, false
	}
	rec.Fields = collectFields(raw, used)
	return rec, true
}

func parseTime(raw map[string]json.RawMessage) (time.Time, string, bool) {
	for _, key := range timeKeys {
		value, ok := raw[key]
		if !ok {
			continue
		}
		var text string
		if json.Unmarshal(value, &text) == nil {
			if at, err := time.Parse(time.RFC3339Nano, text); err == nil {
				return at, key, true
			}
			continue
		}
		var seconds float64
		if json.Unmarshal(value, &seconds) == nil {
			return epochToTime(seconds), key, true
		}
	}
	return time.Time{}, "", false
}

// epochToTime reads both spellings of a numeric timestamp: zap writes epoch
// seconds with a fraction, pino writes epoch milliseconds. A value past the
// year 33658 in seconds is milliseconds — no log line is from the year 33658.
func epochToTime(value float64) time.Time {
	if value > 1e12 {
		return time.UnixMilli(int64(value))
	}
	whole, fraction := math.Modf(value)
	return time.Unix(int64(whole), int64(fraction*1e9))
}

func parseLevel(raw map[string]json.RawMessage) (Level, string, bool) {
	for _, key := range levelKeys {
		value, ok := raw[key]
		if !ok {
			continue
		}
		if level := levelFromValue(value); level != LevelNone {
			return level, key, true
		}
	}
	return LevelNone, "", false
}

// levelFromValue reads one level field, written either as a word (every
// library but pino's default) or as pino's number.
func levelFromValue(value json.RawMessage) Level {
	var text string
	if json.Unmarshal(value, &text) == nil {
		return NormalizeLevel(text)
	}
	var number int
	if json.Unmarshal(value, &number) == nil {
		return numericLevels[number]
	}
	return LevelNone
}

// NormalizeLevel maps every spelling a library writes onto one word.
func NormalizeLevel(text string) Level {
	switch strings.ToLower(strings.TrimSpace(text)) {
	case "trace":
		return LevelTrace
	case "debug":
		return LevelDebug
	case "info", "information", "notice":
		return LevelInfo
	case "warn", "warning":
		return LevelWarn
	case "error", "err", "dpanic":
		return LevelError
	case "fatal", "panic", "critical":
		return LevelFatal
	}
	return LevelNone
}

func firstString(raw map[string]json.RawMessage, keys []string) (string, string, bool) {
	for _, key := range keys {
		value, ok := raw[key]
		if !ok {
			continue
		}
		var text string
		if json.Unmarshal(value, &text) == nil {
			return text, key, true
		}
	}
	return "", "", false
}

// collectFields renders every remaining key, sorted, so two runs of the same
// line print identically (Go map order is deliberately random).
func collectFields(raw map[string]json.RawMessage, used map[string]bool) []Field {
	keys := make([]string, 0, len(raw))
	for key := range raw {
		if used[key] || droppedFields[key] {
			continue
		}
		keys = append(keys, key)
	}
	sort.Strings(keys)
	fields := make([]Field, 0, len(keys))
	for _, key := range keys {
		fields = append(fields, Field{Key: key, Value: renderValue(raw[key])})
	}
	return fields
}

// renderValue prints a scalar bare and anything else as compact JSON, quoting
// a string only when leaving it bare would make the key=value pair ambiguous.
func renderValue(value json.RawMessage) string {
	var text string
	if json.Unmarshal(value, &text) == nil {
		if text == "" || strings.ContainsAny(text, " \t\"=") {
			return strconv.Quote(text)
		}
		return text
	}
	compact := strings.TrimSpace(string(value))
	return compact
}

// Render turns one captured line into what a person reads. The result may span
// several lines when the record carries a stack trace.
func Render(line string, opts Options) string {
	rec, ok := Parse(line)
	if !ok {
		return renderPassthrough(line, opts)
	}
	at := opts.Time
	if rec.HasTime {
		at = rec.Time
	}
	var b strings.Builder
	b.WriteString(paint(timeColumn(at), sgrDim, opts.Color))
	b.WriteString("  ")
	b.WriteString(paint(pad(opts.Lane, LaneWidth), opts.LaneColor, opts.Color))
	b.WriteString("  ")
	b.WriteString(paint(pad(string(rec.Level), LevelWidth), levelColor(rec.Level), opts.Color))
	b.WriteString("  ")
	b.WriteString(rec.Message)
	for _, field := range rec.Fields {
		b.WriteString("  ")
		b.WriteString(paint(field.Key+"=", sgrDim, opts.Color))
		b.WriteString(field.Value)
	}
	if rec.Stack != "" {
		for _, frame := range strings.Split(strings.TrimRight(rec.Stack, "\n"), "\n") {
			b.WriteString("\n")
			b.WriteString(paint(stackIndent+strings.TrimRight(frame, "\r"), sgrDim, opts.Color))
		}
	}
	return b.String()
}

// renderPassthrough keeps a non-JSON line exactly as the child wrote it,
// under the same time and lane columns, with the level column left blank so
// the message still starts where every other message does.
func renderPassthrough(line string, opts Options) string {
	return paint(timeColumn(opts.Time), sgrDim, opts.Color) + "  " +
		paint(pad(opts.Lane, LaneWidth), opts.LaneColor, opts.Color) + "  " +
		strings.Repeat(" ", LevelWidth) + "  " + strings.TrimRight(line, "\r\n")
}

func timeColumn(at time.Time) string {
	if at.IsZero() {
		return strings.Repeat(" ", len(TimeLayout))
	}
	return at.Local().Format(TimeLayout)
}

const (
	sgrDim    = "2"
	sgrYellow = "33"
	sgrRed    = "31"
)

func levelColor(level Level) string {
	switch level {
	case LevelDebug, LevelTrace:
		return sgrDim
	case LevelWarn:
		return sgrYellow
	case LevelError, LevelFatal:
		return sgrRed
	case LevelInfo, LevelNone:
		// Info is the ordinary case and needs no color to be found; a line
		// that named no level is not ours to editorialize about.
		return ""
	}
	return ""
}

func paint(text, color string, enabled bool) string {
	if !enabled || color == "" {
		return text
	}
	return "\x1b[" + color + "m" + text + "\x1b[0m"
}

// pad left-aligns text in a fixed column, never truncating: a lane name longer
// than the column pushes its own line out rather than being silently renamed.
func pad(text string, width int) string {
	if len(text) >= width {
		return text
	}
	return text + strings.Repeat(" ", width-len(text))
}

// RenderJSON is the machine-consumer form of a line: the record's own JSON
// with the lane stamped on it, so a `haven logs --json` over several services
// stays attributable. A non-JSON line becomes an object with the raw text as
// its message, so every output line is parseable.
func RenderJSON(line string, opts Options) string {
	trimmed := strings.TrimSpace(line)
	var raw map[string]json.RawMessage
	if strings.HasPrefix(trimmed, "{") && json.Unmarshal([]byte(trimmed), &raw) == nil {
		raw["lane"] = mustMarshal(opts.Lane)
		if _, ok := raw["time"]; !ok && !opts.Time.IsZero() {
			raw["time"] = mustMarshal(opts.Time.UTC().Format(TimeFormat))
		}
		return string(mustMarshalMap(raw))
	}
	return string(mustMarshalMap(map[string]json.RawMessage{
		"time": mustMarshal(opts.Time.UTC().Format(TimeFormat)),
		"lane": mustMarshal(opts.Lane),
		"msg":  mustMarshal(strings.TrimRight(line, "\r\n")),
	}))
}

// TimeFormat is how the shared format writes an instant: RFC 3339, UTC, to the
// millisecond.
const TimeFormat = "2006-01-02T15:04:05.000Z07:00"

func mustMarshal(value any) json.RawMessage {
	encoded, err := json.Marshal(value)
	if err != nil {
		// Only a string or a time reaches here; neither can fail to marshal.
		return json.RawMessage(strconv.Quote(fmt.Sprint(value)))
	}
	return encoded
}

func mustMarshalMap(raw map[string]json.RawMessage) []byte {
	encoded, err := json.Marshal(raw)
	if err != nil {
		return []byte("{}")
	}
	return encoded
}
