package domain

import (
	"fmt"
	"strconv"
)

// Limit is one machine-wide resource cap the operator may set, by its short
// kebab name, from `haven limits` or the hub. Env is the knob every reader
// already resolves it through, so a limit needs no reader of its own.
type Limit struct {
	Name      string
	Env       string
	Unit      string
	Min       int
	AllowZero bool // 0 is a real setting (redis: no cap) below Min
	def       func(LimitMachine) int
	max       func(LimitMachine) int
}

// LimitMachine is what the defaults and bounds are computed against.
type LimitMachine struct {
	TotalRAMBytes uint64
	NumCPU        int
}

func (m LimitMachine) ramMB() int  { return int(m.TotalRAMBytes >> 20) }
func (m LimitMachine) ramGiB() int { return int(m.TotalRAMBytes >> 30) }

// The kebab names `haven limits` and the hub address each limit by.
const (
	LimitClickHouseMemory = "clickhouse-memory-mb"
	LimitObservability    = "observability-memory-mb"
	LimitRedisMaxMemory   = "redis-maxmemory-mb"
	LimitColimaCPUs       = "colima-cpus"
	LimitColimaMemory     = "colima-memory-gib"
	LimitTestWorkers      = "test-workers"
	// LimitInstantEvalMockJudge is a switch, not a cap: 1 judges Instant Evals
	// with the app's deterministic memory judge instead of a real classifier.
	LimitInstantEvalMockJudge = "instant-eval-mock-judge"
)

// Limits is the catalog, in the order `haven limits` prints it.
var Limits = []Limit{
	{
		Name: LimitClickHouseMemory, Env: "LANGWATCH_HAVEN_CH_MEMORY_MB", Unit: "MB", Min: 1024,
		def: func(m LimitMachine) int { return DefaultClickHouseLimits(m.TotalRAMBytes).ContainerMemoryMB },
		max: LimitMachine.ramMB,
	},
	{
		Name: LimitObservability, Env: "LW_OBS_MEMORY_MB", Unit: "MB", Min: 1024,
		def: func(m LimitMachine) int { return DefaultObservabilityLimits(m.TotalRAMBytes, m.NumCPU).MemoryMB },
		max: LimitMachine.ramMB,
	},
	{
		Name: LimitRedisMaxMemory, Env: "HAVEN_REDIS_MAXMEMORY_MB", Unit: "MB", Min: 64, AllowZero: true,
		def: func(LimitMachine) int { return DefaultRedisMaxMemoryMB },
		max: LimitMachine.ramMB,
	},
	{
		Name: LimitColimaCPUs, Env: "HAVEN_COLIMA_CPUS", Unit: "cpus", Min: 1,
		def: func(m LimitMachine) int { return DefaultColimaLimits(m.TotalRAMBytes, m.NumCPU).CPUs },
		max: func(m LimitMachine) int { return m.NumCPU },
	},
	{
		Name: LimitColimaMemory, Env: "HAVEN_COLIMA_MEMORY_GIB", Unit: "GiB", Min: 2,
		def: func(m LimitMachine) int { return DefaultColimaLimits(m.TotalRAMBytes, m.NumCPU).MemoryGiB },
		max: LimitMachine.ramGiB,
	},
	{
		Name: LimitTestWorkers, Env: "HAVEN_TEST_WORKERS", Unit: "workers", Min: 1,
		def: func(m LimitMachine) int { w, _ := UnitTestFullWidth(m.TotalRAMBytes, m.NumCPU, ""); return w },
		max: func(m LimitMachine) int { return m.NumCPU },
	},
	{
		Name: LimitInstantEvalMockJudge, Env: InstantEvalMockJudgeEnv, Unit: "on", Min: 0,
		def: func(LimitMachine) int { return 0 },
		max: func(LimitMachine) int { return 1 },
	},
}

// InstantEvalMockJudgeEnv is the mock judge switch's knob; "1" turns it on.
const InstantEvalMockJudgeEnv = "HAVEN_INSTANT_EVAL_MOCK_JUDGE"

// FindLimit answers the catalog entry for a kebab name.
func FindLimit(name string) (Limit, error) {
	for _, l := range Limits {
		if l.Name == name {
			return l, nil
		}
	}
	names := make([]string, len(Limits))
	for i, l := range Limits {
		names[i] = l.Name
	}
	return Limit{}, fmt.Errorf("unknown limit %q (one of %v)", name, names)
}

// IsLimitEnv reports whether key is the knob of a catalog limit.
func IsLimitEnv(key string) bool {
	for _, l := range Limits {
		if l.Env == key {
			return true
		}
	}
	return false
}

// LimitValue is one resolved limit: what applies, where it came from, and the
// bounds a new value is checked against.
type LimitValue struct {
	Name      string `json:"name"`
	Env       string `json:"env"`
	Unit      string `json:"unit"`
	Value     int    `json:"value"`
	Default   int    `json:"default"`
	Source    string `json:"source"` // default, settings, .env or env
	Min       int    `json:"min"`
	Max       int    `json:"max"`
	AllowZero bool   `json:"allowZero"`
	Applies   string `json:"applies"`
}

// LimitsReport is `haven limits --json` and GET /api/limits.
type LimitsReport struct {
	TotalRAMBytes uint64       `json:"totalRamBytes"`
	CPUs          int          `json:"cpus"`
	Limits        []LimitValue `json:"limits"`
}

// LimitLookup answers one knob's raw text and the layer that supplied it
// (env, .env or settings); ok is false when no layer sets it.
type LimitLookup func(key string) (raw, source string, ok bool)

// ResolveLimits reads every limit through lookup, the same layers every
// reader of the knob sees. Text that is empty or not a number falls back to
// the default, exactly as the readers do.
func ResolveLimits(m LimitMachine, profile string, lookup LimitLookup) LimitsReport {
	report := LimitsReport{TotalRAMBytes: m.TotalRAMBytes, CPUs: m.NumCPU}
	for _, l := range Limits {
		v := LimitValue{
			Name: l.Name, Env: l.Env, Unit: l.Unit, Default: l.def(m), Source: "default",
			Min: l.Min, Max: l.max(m), AllowZero: l.AllowZero,
		}
		v.Value = v.Default
		if raw, source, ok := lookup(l.Env); ok {
			if n, err := strconv.Atoi(raw); err == nil {
				v.Value, v.Source = n, source
			}
		}
		report.Limits = append(report.Limits, v)
	}
	values := report.Values()
	for i := range report.Limits {
		report.Limits[i].Applies = limitApplies(report.Limits[i].Name, profile, values)
	}
	return report
}

// Values is every limit's effective value, by name.
func (r LimitsReport) Values() map[string]int {
	out := make(map[string]int, len(r.Limits))
	for _, v := range r.Limits {
		out[v.Name] = v.Value
	}
	return out
}

// ColimaRestartCommand is the exact command that gives an existing VM its
// configured shape. Haven never runs it: resizing a VM is the owner's call.
func ColimaRestartCommand(profile string, cpus, memoryGiB int) string {
	p := ""
	if profile != "" && profile != "default" {
		p = " -p " + profile
	}
	return fmt.Sprintf("colima stop%s && colima start%s --cpu %d --memory %d", p, p, cpus, memoryGiB)
}

func limitApplies(name, profile string, values map[string]int) string {
	switch name {
	case LimitClickHouseMemory:
		return "next `haven up`: it re-renders the config, and a changed config recreates the container"
	case LimitObservability:
		return "when the observability container is next recreated (an image bump, or remove it and run `haven up`)"
	case LimitRedisMaxMemory:
		return "next `haven up`, which runs `config set maxmemory`"
	case LimitInstantEvalMockJudge:
		return "when the stack is next brought up (haven down, then haven up), on a modular checkout only"
	case LimitColimaCPUs, LimitColimaMemory:
		return "when the VM is recreated or restarted with `" +
			ColimaRestartCommand(profile, values[LimitColimaCPUs], values[LimitColimaMemory]) + "`"
	default:
		return "the next unit test run"
	}
}

// Check refuses a value outside the limit's bounds, or one that leaves a
// container bigger than the colima VM it runs in.
func (r LimitsReport) Check(name string, value int) error {
	var l LimitValue
	for _, v := range r.Limits {
		if v.Name == name {
			l = v
		}
	}
	if value == 0 && l.AllowZero {
		return nil
	}
	if value < l.Min || value > l.Max {
		return fmt.Errorf("%s must be between %d and %d %s on this machine", name, l.Min, l.Max, l.Unit)
	}
	return r.checkFits(name, value)
}

func (r LimitsReport) checkFits(name string, value int) error {
	next := r.Values()
	next[name] = value
	vmMB := next[LimitColimaMemory] * 1024
	for _, container := range []string{LimitClickHouseMemory, LimitObservability} {
		if next[container] > vmMB && (name == container || name == LimitColimaMemory) {
			return fmt.Errorf("%s (%d MB) would not fit the colima VM (%d GiB)", container, next[container], next[LimitColimaMemory])
		}
	}
	return nil
}
