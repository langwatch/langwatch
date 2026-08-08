package domain

import "time"

// Pressure is how much trouble the machine is in. It is deliberately coarse:
// three levels, each with one response, so a reader can tell what haven will do
// without knowing the thresholds. See ADR-090.
type Pressure int

const (
	// Green is an unloaded machine: admit heavy runs at full width, demote nothing.
	Green Pressure = iota
	// Amber demotes the unfocused stacks and stops admitting at full width. It
	// does not refuse work.
	Amber
	// Red additionally refuses a heavy run that finds no free slot.
	Red
)

// String renders a level for the doctor.
func (p Pressure) String() string {
	switch p {
	case Amber:
		return "amber"
	case Red:
		return "red"
	default:
		return "green"
	}
}

// MemStat is what the machine reports about its own memory right now.
//
// Summed process RSS is deliberately absent. GroupRSS sums `ps` output, which
// double-counts shared pages and overstates by several GB — it is fine for
// "what is this stack roughly costing" in the doctor, and wrong as a control
// input. The honest signals are how hard the compressor is working and whether
// swap is filling.
type MemStat struct {
	TotalBytes uint64
	// CompressedBytes is the memory the compressor OCCUPIES, not the (much
	// larger) amount it has stored. On the machine that motivated ADR-090 those
	// two read 2 GiB and 10 GiB; quoting the wrong one overstates by five times.
	CompressedBytes uint64
	SwapUsedBytes   uint64
	SwapTotalBytes  uint64
}

// Pressure thresholds, as fractions. Picked from what was observed on a
// laptop running several worktrees, not from anything the OS enforces — so
// they are a heuristic, and ADR-090 says so rather than implying it measured
// a limit the system actually applies.
const (
	amberSwapFraction = 0.40
	redSwapFraction   = 0.75
	amberCompFraction = 0.10
	redCompFraction   = 0.20
)

// ClassifyPressure reads a level off the machine. An undetectable machine is
// green: a governor that cannot see must not throttle.
//
// Either signal alone can raise the level. A machine with swap disabled has a
// permanently zero swap term and still thrashes its compressor, so requiring
// both would never fire there.
func ClassifyPressure(m MemStat) Pressure {
	if m.TotalBytes == 0 {
		return Green
	}
	compFraction := float64(m.CompressedBytes) / float64(m.TotalBytes)
	swapFraction := 0.0
	if m.SwapTotalBytes > 0 {
		swapFraction = float64(m.SwapUsedBytes) / float64(m.SwapTotalBytes)
	}
	switch {
	case swapFraction > redSwapFraction || compFraction > redCompFraction:
		return Red
	case swapFraction > amberSwapFraction || compFraction > amberCompFraction:
		return Amber
	default:
		return Green
	}
}

// heavyRunBudget is what one heavy run is assumed to want. Sized from the
// measured 573 MB per vitest fork times a default width, rounded to something
// a reader can hold in their head.
const heavyRunBudget = uint64(3) << 30

// HeavySlots is how many heavy runs may be in flight across the whole machine.
//
// Sized from what is actually FREE rather than from total RAM. The difference
// is not academic: on a laptop with a container VM holding 8 GiB, total memory
// overstates what this process can have by nearly half, and a limit computed
// from it over-admits by exactly the amount some other tenant is holding.
// Compressor occupancy is subtracted for the same reason — it is memory the
// machine has already had to work to reclaim.
//
// Capped by cores as well, because these runs saturate CPU as readily as RAM,
// and never below one, or nothing would ever run.
func HeavySlots(m MemStat, numCPU int) int {
	usable := m.TotalBytes
	if m.CompressedBytes < usable {
		usable -= m.CompressedBytes
	}
	slots := 1
	if usable >= heavyRunBudget {
		slots = int(usable / heavyRunBudget)
	}
	if numCPU > 0 {
		slots = min(slots, max(numCPU/4, 1))
	}
	return max(slots, 1)
}

// CallerKind is who asked for a heavy run. It decides the wait ceiling, because
// it decides the prompt-cache floor.
//
// Measured across 40 transcripts (14,121 cache-writing requests, ~53M
// cache-write tokens): sub-agent sessions write the five-minute cache 100% of
// the time and main sessions write the one-hour cache 100% of the time, with no
// request writing both. So a sub-agent parked past five minutes returns to a
// cold cache, and a main session has an hour of headroom.
type CallerKind int

const (
	// SubAgent holds the five-minute cache. This is the population that expires,
	// and the one a fleet of parallel agents is made of.
	SubAgent CallerKind = iota
	// MainSession holds the one-hour cache.
	MainSession
	// Interactive is a human at a terminal. Not an idle API session at all.
	Interactive
)

// CacheFloor is how long this caller can be idle before its prompt cache goes.
func (c CallerKind) CacheFloor() time.Duration {
	if c == SubAgent {
		return 5 * time.Minute
	}
	return time.Hour
}

// LongFailsafe is the existing wait ceiling from the shared check queue. It
// sits comfortably inside a one-hour floor, which is why only a sub-agent needs
// anything tighter.
const LongFailsafe = 30 * time.Minute

// subAgentCeiling leaves a minute of margin under the five-minute floor for the
// model's own round-trip after the tool returns.
const subAgentCeiling = 4 * time.Minute

// WaitCeiling is the longest haven may hold this caller waiting for a slot.
func (c CallerKind) WaitCeiling() time.Duration {
	if c == SubAgent {
		return subAgentCeiling
	}
	return LongFailsafe
}

// CallerFromAgentID reads the caller kind off the hook payload's agent id.
// Present means a sub-agent; absent means a main session.
//
// An unidentifiable caller is treated as a sub-agent, because that keeps the
// tighter ceiling: misreading a sub-agent as a main session silently restores
// the long park this whole mechanism exists to prevent.
func CallerFromAgentID(agentID string, interactive bool) CallerKind {
	switch {
	case interactive:
		return Interactive
	case agentID != "":
		return SubAgent
	default:
		return MainSession
	}
}

// PressureRecord is what the daemon publishes and other processes read.
// Versioned so a newer daemon and an older reader can disagree safely.
type PressureRecord struct {
	Version   int       `json:"version"`
	Level     string    `json:"level"`
	WrittenAt time.Time `json:"writtenAt"`
}

// PressureRecordVersion is the current record shape. A reader that does not
// know the version treats the record as absent.
const PressureRecordVersion = 1

// PressureStaleAfter is how old a record may be before it stops being believed.
// Generously more than the daemon's 10s tick, so an ordinary scheduling hiccup
// does not blind every reader on the machine.
const PressureStaleAfter = 90 * time.Second

// ReadPressure interprets a published record. Absent, unparseable, stale, or
// written by a version this build does not know all resolve to green, which
// disables narrowing and refusal — and nothing else. Slot counting never
// depends on this.
func ReadPressure(rec PressureRecord, ok bool, now time.Time) Pressure {
	if !ok || rec.Version != PressureRecordVersion {
		return Green
	}
	if now.Sub(rec.WrittenAt) > PressureStaleAfter {
		return Green
	}
	switch rec.Level {
	case "red":
		return Red
	case "amber":
		return Amber
	default:
		return Green
	}
}
