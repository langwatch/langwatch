package domain

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
)

// Dynamic check capacity. ResolveCheckUnits is the budget an otherwise idle machine is
// sized for; this reads how idle the machine actually is and grows a still
// one's budget and run widths, then gives a boot someone is waiting on the
// cores first. Every rule applies at admission: a running run keeps its units.

// CapacityTier is the daemon's reading of the machine's idle headroom, with
// hysteresis: entering quiet takes a lower load than leaving it.
type CapacityTier string

const (
	// CapacityNormal is today's budget and widths.
	CapacityNormal CapacityTier = "normal"
	// CapacityQuiet grows the budget to the cores and doubles run widths.
	CapacityQuiet CapacityTier = "quiet"
)

// Hysteresis band, as fractions of cores (load) and of RAM (available). Enter
// quiet at a 1-minute load at or below a third of the cores with a quarter of
// RAM free; leave it at six tenths of the cores or under a sixth free. The gap
// is what keeps a load hovering near one line from flapping the tier.
const (
	quietEnterLoad = 0.35
	quietLeaveLoad = 0.60
	quietEnterFree = 0.25
	quietLeaveFree = 0.15
)

// MachineLoad is one sample of what the machine is doing.
type MachineLoad struct {
	Load1          float64
	NumCPU         int
	AvailableBytes uint64
	TotalBytes     uint64
}

// NextCapacityTier is the tier after prev given a fresh sample. A sample with
// no cores or no RAM reads normal: a governor that cannot see must not grow.
func NextCapacityTier(prev CapacityTier, m MachineLoad) CapacityTier {
	if m.NumCPU <= 0 || m.TotalBytes == 0 || m.Load1 < 0 || math.IsNaN(m.Load1) {
		return CapacityNormal
	}
	load := m.Load1 / float64(m.NumCPU)
	free := float64(m.AvailableBytes) / float64(m.TotalBytes)
	if prev == CapacityQuiet {
		if load < quietLeaveLoad && free >= quietLeaveFree {
			return CapacityQuiet
		}
		return CapacityNormal
	}
	if load <= quietEnterLoad && free >= quietEnterFree {
		return CapacityQuiet
	}
	return CapacityNormal
}

// CapacityReading is the tier and the sample it came from, as the daemon
// publishes it beside the pressure level.
type CapacityReading struct {
	Tier           CapacityTier `json:"tier"`
	Load1          float64      `json:"load1"`
	NumCPU         int          `json:"numCpu"`
	AvailableBytes uint64       `json:"availableBytes"`
}

// ReadCapacity believes a published reading only when its record is fresh and
// of a known version; otherwise ok is false and the caller measures itself.
func ReadCapacity(rec PressureRecord, ok bool, now time.Time) (CapacityReading, bool) {
	if !ok || rec.Version != PressureRecordVersion || now.Sub(rec.WrittenAt) > PressureStaleAfter {
		return CapacityReading{}, false
	}
	if rec.Capacity.Tier != CapacityQuiet && rec.Capacity.Tier != CapacityNormal {
		return CapacityReading{}, false
	}
	return rec.Capacity, true
}

// CapacityRequest is everything ResolveCapacity decides from.
type CapacityRequest struct {
	Machine CheckMachine
	Env     CheckEnv
	Reading CapacityReading
	// BootsWaited is how many stack boots a `haven wait` or attached up is
	// blocked on right now.
	BootsWaited int
	// BootWork marks a run that is itself part of a waited-on boot.
	BootWork bool
}

// Capacity is the budget a run is admitted against, and why.
type Capacity struct {
	Units  int
	Source string
	Tier   CapacityTier
	// Headroom is the idle cores a quiet machine measured; it bounds how far a
	// run's width may grow.
	Headroom   int
	Load1      float64
	NumCPU     int
	BootsAhead int
	BootWork   bool
}

// ResolveCapacity applies the two rules to ResolveCheckUnits' derived budget.
// Quiet: the budget grows to every core (bounded by RAM) and runs may double
// their width up to the idle cores. A waited-on boot: a check gets half the
// budget and the background band; the boot's own runs keep the full budget.
// An explicit CHECK_SLOTS, CI or a held run is never reshaped.
func ResolveCapacity(r CapacityRequest) Capacity {
	units, source := ResolveCheckUnits(r.Machine, r.Env)
	c := Capacity{
		Units: units, Source: source, Tier: CapacityNormal,
		Load1: r.Reading.Load1, NumCPU: r.Machine.NumCPU, BootWork: r.BootWork,
	}
	if source != "machine" && source != "pressure" {
		return c
	}
	if r.BootsWaited > 0 && !r.BootWork {
		c.BootsAhead = r.BootsWaited
		c.Units = max(checkUnitsPerCheck, units/2)
		return c
	}
	if r.Reading.Tier != CapacityQuiet || source != "machine" {
		return c
	}
	c.Tier = CapacityQuiet
	byMemory := int(r.Machine.TotalRAMBytes / checkRAMPerUnit)
	c.Units = max(units, min(r.Machine.NumCPU, byMemory))
	c.Headroom = max(0, int(float64(r.Machine.NumCPU)-r.Reading.Load1))
	return c
}

// RunUnits is the units one run of class takes under c, and so its GOMAXPROCS
// and Vitest workers: today's weight, doubled on a quiet machine up to its
// idle cores, never above the budget. A zero budget (the gate off) keeps the weight.
func (c Capacity) RunUnits(class SlotClass, vitestMaxWorkers string) int {
	units := SlotWeight(class, vitestMaxWorkers)
	if c.Tier == CapacityQuiet {
		want := units * 2
		if asked, err := strconv.Atoi(strings.TrimSpace(vitestMaxWorkers)); class == ClassTest && err == nil && asked > units {
			want = min(asked, testUnitsMax*2)
		}
		units = min(want, max(units, c.Headroom))
	}
	if c.Units <= 0 {
		return units
	}
	return max(1, min(units, c.Units))
}

// Background reports that a run admitted now goes to the background band
// (`nice -n 10`) rather than utility: a check while a waited-on boot runs.
func (c Capacity) Background() bool { return c.BootsAhead > 0 && !c.BootWork }

// Describe says the capacity and why, in one clause: "quiet, load 1.2 on 10
// cores: 10 units" or "busy, load 40 on 10 cores: 4 units; a boot is ahead of
// you". The status page and every waiting line print it.
func (c Capacity) Describe() string {
	switch c.Source {
	case "CHECK_SLOTS", "held":
		return fmt.Sprintf("%d units, set by CHECK_SLOTS", c.Units)
	case "CI":
		return "no limit under CI"
	}
	var b strings.Builder
	b.WriteString(c.mood())
	if c.NumCPU > 0 {
		fmt.Fprintf(&b, ", load %s on %d cores", formatLoad(c.Load1), c.NumCPU)
	}
	fmt.Fprintf(&b, ": %d units", c.Units)
	switch {
	case c.BootsAhead == 1:
		b.WriteString("; a boot is ahead of you")
	case c.BootsAhead > 1:
		fmt.Fprintf(&b, "; %d boots are ahead of you", c.BootsAhead)
	case c.BootWork:
		b.WriteString("; this run is part of a boot someone is waiting on")
	}
	return b.String()
}

// mood is the first word of Describe.
func (c Capacity) mood() string {
	switch {
	case c.Source == "pressure":
		return "memory pressure"
	case c.Tier == CapacityQuiet:
		return "quiet"
	case c.NumCPU > 0 && c.Load1/float64(c.NumCPU) >= quietLeaveLoad:
		return "busy"
	default:
		return "steady"
	}
}

// formatLoad prints a load average the way uptime does, without a trailing ".0".
func formatLoad(load float64) string {
	if load >= 10 {
		return strconv.Itoa(int(math.Round(load)))
	}
	return strconv.FormatFloat(math.Round(load*10)/10, 'f', -1, 64)
}

// ParseVMStatAvailable is the memory the machine can hand out without paging,
// from `vm_stat`: free, inactive and speculative pages times the page size.
func ParseVMStatAvailable(out string) (uint64, bool) {
	var pageSize, pages uint64
	var seen int
	for line := range strings.SplitSeq(out, "\n") {
		if n, found := vmStatPageSize(line); found {
			pageSize = n
			continue
		}
		if n, found := vmStatAvailablePages(line); found {
			pages += n
			seen++
		}
	}
	if pageSize == 0 || seen == 0 {
		return 0, false
	}
	return pages * pageSize, true
}

// BootsWaitedOn counts the distinct stacks a boot claim names, and reports
// whether ownStack (HAVEN_BOOT, set in a boot's own processes) is one of them.
func BootsWaitedOn(stacks []string, ownStack string) (count int, ownIsWaited bool) {
	seen := make(map[string]bool, len(stacks))
	for _, s := range stacks {
		if s == "" || seen[s] {
			continue
		}
		seen[s] = true
		count++
		ownIsWaited = ownIsWaited || s == ownStack
	}
	return count, ownIsWaited
}

// ParseProcLoadavg reads the 1-minute average from Linux's /proc/loadavg
// ("0.52 0.58 0.59 1/389 12345"); -1 when it does not parse.
func ParseProcLoadavg(raw string) float64 {
	fields := strings.Fields(raw)
	if len(fields) == 0 {
		return -1
	}
	load, err := strconv.ParseFloat(fields[0], 64)
	if err != nil || load < 0 || math.IsNaN(load) {
		return -1
	}
	return load
}

// SampleLoad is one MachineLoad from the load average, the cores and MemStat.
func SampleLoad(load1 float64, numCPU int, mem MemStat) MachineLoad {
	return MachineLoad{Load1: load1, NumCPU: numCPU, AvailableBytes: mem.AvailableBytes, TotalBytes: mem.TotalBytes}
}

// MeasureCapacity is the reading for one sample, stepped from prev.
func MeasureCapacity(prev CapacityTier, m MachineLoad) CapacityReading {
	return CapacityReading{
		Tier: NextCapacityTier(prev, m), Load1: max(m.Load1, 0), NumCPU: m.NumCPU, AvailableBytes: m.AvailableBytes,
	}
}

// BootWaitName is the waiter registry a `haven wait --for ready` or an attached
// up registers under while it is blocked on a boot; each claim's command is the
// stack slug it waits on.
const BootWaitName = "boot"

// RunBand is the CPU band an agent's admitted run is spawned in on macOS.
type RunBand string

const (
	// BandDefault is no clamp: a waited-on boot's own run.
	BandDefault RunBand = "default"
	// BandUtility is `taskpolicy -c utility`, an agent's check normally.
	BandUtility RunBand = "utility"
	// BandBackground is `nice -n 10`, an agent's check behind a waited-on boot:
	// lower priority on every core, where `taskpolicy -b` pinned it to the E-cores.
	BandBackground RunBand = "background"
)

// AgentBand is the band an agent's run admitted under c gets.
func (c Capacity) AgentBand() RunBand {
	switch {
	case c.BootWork:
		return BandDefault
	case c.Background():
		return BandBackground
	default:
		return BandUtility
	}
}

// vmStatAvailablePages reads one of the free, inactive or speculative lines.
func vmStatAvailablePages(line string) (uint64, bool) {
	for _, label := range []string{"Pages free:", "Pages inactive:", "Pages speculative:"} {
		if _, rest, found := strings.Cut(line, label); found {
			n, err := strconv.ParseUint(strings.TrimSuffix(strings.TrimSpace(rest), "."), 10, 64)
			return n, err == nil
		}
	}
	return 0, false
}
