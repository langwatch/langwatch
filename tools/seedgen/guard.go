package seedgen

import (
	"fmt"
	"io"
	"slices"
	"strings"
	"time"
)

// The guard's signals (design §5.3).
const (
	SignalWorkerBacklog    = "worker_backlog"
	SignalClickHouseMemory = "clickhouse_memory"
	SignalClickHouseParts  = "clickhouse_parts"
	SignalRedisMemory      = "redis_memory"
	SignalHostPressure     = "host_pressure"
	SignalRefusals         = "refusals"
)

// Threshold is when a signal halves the window, pauses sending, and resumes it after a pause.
type Threshold struct{ Halve, Pause, Resume float64 }

// Thresholds are design §5.3's table. Host pressure reads 0 normal, 1 warn, 2 critical; refusals
// read the retryable refusals in a row.
var Thresholds = map[string]Threshold{
	SignalWorkerBacklog:    {Halve: 20_000, Pause: 50_000, Resume: 10_000},
	SignalClickHouseMemory: {Halve: 0.70, Pause: 0.85, Resume: 0.60},
	SignalClickHouseParts:  {Halve: 150, Pause: 300, Resume: 100},
	SignalRedisMemory:      {Halve: 0.70, Pause: 0.85, Resume: 0.60},
	SignalHostPressure:     {Halve: 1, Pause: 2, Resume: 1},
	SignalRefusals:         {Halve: 1, Pause: 3, Resume: 1},
}

// Reading is one signal's value at one read.
type Reading struct {
	Signal string
	Value  float64
}

func (r Reading) String() string { return fmt.Sprintf("%s=%g", r.Signal, r.Value) }

// The window's bounds (design §5.3) and how long a pause may last before the run stalls (§5.4).
const (
	WindowStart = 4
	WindowFloor = 1
	WindowCeil  = 32
	StallAfter  = 10 * time.Minute
	cleanReads  = 3
)

// Guard is the AIMD window over in-flight steps: it halves on a signal past its threshold, pauses
// past the critical one, and grows by one after three clean reads.
type Guard struct {
	Window      int
	Paused      *Reading
	pausedSince time.Time
	clean       int
	log         io.Writer
}

// NewGuard starts the window at 4; every change is logged once to log, naming its signal.
func NewGuard(log io.Writer) *Guard {
	return &Guard{Window: WindowStart, log: log}
}

// Observe applies one round of readings taken at now.
func (g *Guard) Observe(now time.Time, readings []Reading) {
	if g.Paused != nil {
		current := g.find(readings, g.Paused.Signal)
		if current != nil && current.Value >= Thresholds[current.Signal].Resume {
			return
		}
		g.logf("resumed: %s below %g", g.Paused.Signal, Thresholds[g.Paused.Signal].Resume)
		g.Paused, g.clean = nil, 0
	}
	if critical := g.worst(readings, func(t Threshold) float64 { return t.Pause }); critical != nil {
		g.Paused, g.pausedSince, g.clean = critical, now, 0
		g.logf("paused: %s (pause at %g)", critical, Thresholds[critical.Signal].Pause)
		return
	}
	if high := g.worst(readings, func(t Threshold) float64 { return t.Halve }); high != nil {
		g.clean = 0
		if next := max(WindowFloor, g.Window/2); next != g.Window {
			g.logf("window %d -> %d: %s (halve at %g)", g.Window, next, high, Thresholds[high.Signal].Halve)
			g.Window = next
		}
		return
	}
	g.clean++
	if g.clean >= cleanReads && g.Window < WindowCeil {
		g.clean = 0
		g.logf("window %d -> %d: %d clean reads", g.Window, g.Window+1, cleanReads)
		g.Window++
	}
}

// Stalled names the signal that has held a pause for StallAfter.
func (g *Guard) Stalled(now time.Time) (Reading, bool) {
	if g.Paused == nil || now.Sub(g.pausedSince) < StallAfter {
		return Reading{}, false
	}
	return *g.Paused, true
}

func (g *Guard) find(readings []Reading, signal string) *Reading {
	index := slices.IndexFunc(readings, func(r Reading) bool { return r.Signal == signal })
	if index < 0 {
		return nil
	}
	return &readings[index]
}

// worst is the reading furthest past its limit, or nil when none reaches it.
func (g *Guard) worst(readings []Reading, limit func(Threshold) float64) *Reading {
	var worst *Reading
	var ratio float64
	for i, reading := range readings {
		threshold, known := Thresholds[reading.Signal]
		if !known || reading.Value < limit(threshold) {
			continue
		}
		if r := reading.Value / limit(threshold); worst == nil || r > ratio {
			worst, ratio = &readings[i], r
		}
	}
	if worst == nil {
		return nil
	}
	copied := *worst
	return &copied
}

func (g *Guard) logf(format string, args ...any) {
	if g.log != nil {
		_, _ = fmt.Fprintln(g.log, "seedgen guard: "+strings.TrimSpace(fmt.Sprintf(format, args...)))
	}
}
