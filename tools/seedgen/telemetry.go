package seedgen

import (
	"fmt"
	"iter"
	"math/rand/v2"
	"strconv"
	"time"

	"github.com/langwatch/langwatch/services/telemetrysim"
)

// Telemetry action kinds: each carries one OTLP JSON export request as its input (design §2).
const (
	KindTraceOTLP  = "trace.otlp"
	KindLogOTLP    = "log.otlp"
	KindMetricOTLP = "metric.otlp"
)

// Chunk bounds (design §5.2): whole traces up to 500 spans, 1,000 log records or metric points,
// and never more than 4 MB encoded.
const (
	MaxChunkSpans   = 500
	MaxChunkRecords = 1_000
	MaxChunkBytes   = 4 << 20
)

// SpanMaxPast is the public trace door's past limit. A trace chunk older than it takes the
// in-process backdated input of ruling Q1 (a), which SG9 adds; see Backdated.
const SpanMaxPast = 31 * 24 * time.Hour

// Backdated reports whether a trace chunk needs the backdated input: its At, the cell's hour, is
// past SpanMaxPast. Timestamps are never moved; the runner picks the input by this.
func Backdated(action Action, now time.Time) bool {
	at, err := time.Parse(time.RFC3339, action.At)
	return action.Kind == KindTraceOTLP && err == nil && now.Sub(at) > SpanMaxPast
}

type share struct {
	preset string
	weight int
}

// traceMix is each persona's characteristic trace shapes (design §7) by weight.
var traceMix = map[string][]share{
	"startup":    {{"llm-trace", 35}, {"rag-trace", 35}, {"error-trace", 15}, {"guardrail-trace", 15}},
	"enterprise": {{"rag-trace", 30}, {"guardrail-trace", 25}, {"eval-trace", 20}, {"rum-trace", 15}, {"error-trace", 10}},
	"gateway":    {{"llm-trace", 40}, {"multimodal-trace", 30}, {"rum-trace", 15}, {"error-trace", 15}},
	"agent-eval": {{"eval-trace", 30}, {"claude-code-session", 25}, {"codex-session", 25}, {"wide-trace", 10}, {"error-trace", 10}},
}

func preset(name string) telemetrysim.Preset {
	p, ok := telemetrysim.PresetByName(name)
	if !ok {
		panic("seedgen: telemetrysim has no preset " + name)
	}
	return p
}

// Chunks yields a cell step's OTLP chunks, traces then logs then metrics, with ids
// "<run>/<seq>.<k>". The same cell and seed give the same chunks; nothing is held past a yield.
func (p *Plan) Chunks(step Step) iter.Seq2[Action, error] {
	return func(yield func(Action, error) bool) {
		if step.Cell == nil {
			return
		}
		cell := *step.Cell
		c := &chunker{cell: cell, id: p.Run + "/" + strconv.FormatInt(step.Seq, 10), yield: yield,
			seed: p.draws.Uint64("telemetry:"+cell.Project, cell.Start.Unix(), "seed")}
		traces := c.traces
		if cell.Turns > 0 {
			traces = c.conversation
		}
		_ = traces() && c.records(KindLogOTLP, preset("logs"), cell.Logs) &&
			c.records(KindMetricOTLP, preset("metrics"), cell.MetricPoints)
	}
}

type chunker struct {
	cell  Cell
	id    string
	seed  uint64
	k     int
	yield func(Action, error) bool
}

// traces deals the cell's spans into whole traces of the persona's mix, the last cut short so
// the count is exact, and packs them into chunks of at most MaxChunkSpans.
func (c *chunker) traces() bool {
	mix := traceMix[c.cell.Persona]
	if mix == nil {
		mix = traceMix["startup"]
	}
	total := 0
	for _, s := range mix {
		total += s.weight
	}
	draw := rand.New(rand.NewPCG(c.seed, 0)) //nolint:gosec // seeded on purpose: the plan is deterministic
	var parts []telemetrysim.Part
	spans := 0
	for i, left := 0, c.cell.Spans; left > 0; i++ {
		p := preset(pick(mix, draw.IntN(total)))
		n := min(len(p.Spans), left)
		left -= n
		if spans+n > MaxChunkSpans {
			if !c.send(KindTraceOTLP, parts) {
				return false
			}
			parts, spans = nil, 0
		}
		parts, spans = append(parts, telemetrysim.Part{Preset: p, Index: i, Count: n}), spans+n
	}
	return len(parts) == 0 || c.send(KindTraceOTLP, parts)
}

// conversation sends the cell's turns as one chunk: one trace each, a minute or two apart, all
// on the cell's thread. Logs and metrics follow as for any cell.
func (c *chunker) conversation() bool {
	turn, gap := preset("conversation-turn"), min(2*time.Minute, 55*time.Minute/time.Duration(c.cell.Turns))
	parts := make([]telemetrysim.Part, c.cell.Turns)
	for i := range parts {
		parts[i] = telemetrysim.Part{Preset: turn, Index: i, Count: conversationSpans, Thread: c.cell.Thread,
			At: c.cell.Start.Add(time.Duration(i) * gap)}
	}
	return c.send(KindTraceOTLP, parts)
}

// pick is the mix's preset at draw, a number below the mix's total weight.
func pick(mix []share, draw int) string {
	for _, s := range mix {
		if draw < s.weight {
			return s.preset
		}
		draw -= s.weight
	}
	return mix[0].preset
}

func (c *chunker) records(kind string, p telemetrysim.Preset, count int) bool {
	for from := 0; from < count; from += MaxChunkRecords {
		if !c.send(kind, []telemetrysim.Part{{Preset: p, Index: from, Count: min(MaxChunkRecords, count-from)}}) {
			return false
		}
	}
	return true
}

func (c *chunker) send(kind string, parts []telemetrysim.Part) bool {
	payload, err := telemetrysim.BuildBackfill(telemetrysim.Backfill{Seed: c.seed, Start: c.cell.Start, Window: time.Hour,
		Parts: parts, Encoding: telemetrysim.EncodingJSON})
	if err == nil && len(payload.Body) > MaxChunkBytes {
		err = fmt.Errorf("%s chunk of %s at %s is %d bytes, over %d", kind, c.cell.Project, c.cell.Start, len(payload.Body), MaxChunkBytes)
	}
	if err != nil {
		c.yield(Action{}, err)
		return false
	}
	id := c.id + "." + strconv.Itoa(c.k)
	c.k++
	count := 0
	for i := range parts {
		count += parts[i].Count
	}
	return c.yield(Action{ID: id, Kind: kind, Org: c.cell.Org, Project: c.cell.Project, Key: id,
		Input: payload.Body, At: c.cell.Start.Format(time.RFC3339), Count: count}, nil)
}
