package domain

import "strings"

// FootprintSample is one live process as the memory partitioner needs it: its
// group (to attribute it to a stack) and its command line (to attribute it to
// anything else).
type FootprintSample struct {
	PID     int
	PGID    int
	RSS     int64
	Command string
}

// Footprint is the machine's dev-work memory picture, every process attributed
// exactly once. RSS sums double-count shared pages, so these are honest
// approximations, not accounting — the point is that the shared database
// servers, the container VM, the coding agents and the dev tooling appear at
// all, where the old launcher-group-only number silently omitted them.
type Footprint struct {
	// StackRSS is each stack's whole process group, keyed by launcher pid —
	// haven spawns launchers as group leaders, so the pid is the group id.
	StackRSS map[int]int64
	// ServerRSS is the shared machine-wide servers by name: "clickhouse",
	// "postgres", "redis", and "containers" for the container VM (which is
	// where managed ClickHouse and the observability stack live when they run
	// as containers).
	ServerRSS map[string]int64
	// Agents are coding-agent processes (claude) outside any stack group.
	AgentRSS   int64
	AgentCount int
	// Tooling is the dev tooling outside any stack group: compilers, checkers,
	// test workers and the JS runtimes they spawn.
	ToolingRSS   int64
	ToolingCount int
}

// StacksRSS is every stack group summed.
func (f Footprint) StacksRSS() int64 {
	var total int64
	for _, rss := range f.StackRSS {
		total += rss
	}
	return total
}

// ServersRSS is every shared server summed.
func (f Footprint) ServersRSS() int64 {
	var total int64
	for _, rss := range f.ServerRSS {
		total += rss
	}
	return total
}

// TotalRSS is everything the partitioner attributed, summed.
func (f Footprint) TotalRSS() int64 {
	return f.StacksRSS() + f.ServersRSS() + f.AgentRSS + f.ToolingRSS
}

// PartitionFootprint attributes every sample to exactly one bucket. Group
// membership wins: a process inside a stack's group belongs to that stack no
// matter what its command says, so a stack's node servers are never misfiled
// as tooling. Everything else is attributed by command — a shared server, a
// coding agent, dev tooling — or dropped as not dev work.
func PartitionFootprint(samples []FootprintSample, launcherPIDs []int) Footprint {
	launchers := make(map[int]bool, len(launcherPIDs))
	f := Footprint{StackRSS: map[int]int64{}, ServerRSS: map[string]int64{}}
	for _, pid := range launcherPIDs {
		launchers[pid] = true
		f.StackRSS[pid] = 0
	}
	for _, s := range samples {
		if launchers[s.PGID] {
			f.StackRSS[s.PGID] += s.RSS
			continue
		}
		if server, ok := classifyServer(s.Command); ok {
			f.ServerRSS[server] += s.RSS
			continue
		}
		w, ok := ClassifyWatchedProcess(s.Command)
		if !ok {
			continue
		}
		if w.Class == "claude" {
			f.AgentRSS += s.RSS
			f.AgentCount++
			continue
		}
		f.ToolingRSS += s.RSS
		f.ToolingCount++
	}
	return f
}

// classifyServer names the shared machine-wide servers the footprint reports:
// the database servers however they run (brew, native binary, LaunchAgent) and
// the container VM as a whole. Postgres helper processes show up as
// "postgres: checkpointer" on macOS, so the binary base is trimmed of the
// colon before matching.
func classifyServer(command string) (string, bool) {
	base := strings.TrimSuffix(binaryBase(command), ":")
	switch {
	case strings.HasPrefix(base, "clickhouse"):
		return "clickhouse", true
	case base == "postgres" || base == "postmaster":
		return "postgres", true
	case base == "redis-server":
		return "redis", true
	case strings.Contains(command, "Virtualization.VirtualMachine") || strings.HasPrefix(base, "qemu-system"):
		return "containers", true
	}
	return "", false
}
