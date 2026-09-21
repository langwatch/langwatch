package domain

import "strings"

// FootprintSample is one live process as the memory partitioner needs it: its
// lineage (to attribute it to a stack), and its command line (to attribute it
// to anything else).
type FootprintSample struct {
	PID     int
	PPID    int
	PGID    int
	RSS     int64
	Command string
}

// Footprint is the machine's memory picture, every process attributed exactly
// once. RSS sums double-count shared pages, so these are honest approximations,
// not accounting — the point is that the shared database servers, the container
// VM, the coding agents, the dev tooling and everything else on the machine
// appear at all, where the old launcher-group-only number silently omitted them.
type Footprint struct {
	// StackRSS is each stack's whole process TREE, keyed by launcher pid.
	// Supervised children lead their own process groups on purpose (that is how
	// one child is bounced without killing its siblings), so group membership
	// alone sees only the launcher itself — descendants are what a stack costs.
	StackRSS map[int]int64
	// ServerRSS is the shared machine-wide servers by name: "clickhouse",
	// "postgres", "redis", and "containers" for the container VM (which is
	// where managed ClickHouse and the observability stack live when they run
	// as containers).
	ServerRSS map[string]int64
	// Agents are coding-agent processes (claude) outside any stack tree.
	AgentRSS   int64
	AgentCount int
	// Tooling is the dev tooling outside any stack tree: compilers, checkers,
	// test workers and the JS runtimes they spawn.
	ToolingRSS   int64
	ToolingCount int
	// Other is everything else alive on the machine — browsers, the OS, the
	// user's non-dev work. Shown in its own color so the RAM chart reflects
	// the whole machine, not just the dev slice.
	OtherRSS   int64
	OtherCount int
}

// StacksRSS is every stack tree summed.
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

// DevRSS is everything attributed to dev work, summed.
func (f Footprint) DevRSS() int64 {
	return f.StacksRSS() + f.ServersRSS() + f.AgentRSS + f.ToolingRSS
}

// TotalRSS is everything the partitioner saw, summed — dev and other alike.
func (f Footprint) TotalRSS() int64 {
	return f.DevRSS() + f.OtherRSS
}

// PartitionFootprint attributes every sample to exactly one bucket. Shared
// servers are claimed first — a database server is machine-wide even when a
// stack's launcher happened to spawn it. Then stack lineage wins: a process
// descended from (or grouped with) a launcher belongs to that stack no matter
// what its command says, so a stack's node servers are never misfiled as
// tooling. What remains is attributed by command — a coding agent, dev
// tooling — and everything else lands in Other.
func PartitionFootprint(samples []FootprintSample, launcherPIDs []int) Footprint {
	f := Footprint{StackRSS: map[int]int64{}, ServerRSS: map[string]int64{}}
	for _, pid := range launcherPIDs {
		f.StackRSS[pid] = 0
	}
	stackOf := stackMembership(samples, launcherPIDs)
	for _, s := range samples {
		switch {
		case attributeServer(&f, s):
		case attributeStack(&f, s, stackOf):
		case attributeDev(&f, s):
		default:
			f.OtherRSS += s.RSS
			f.OtherCount++
		}
	}
	return f
}

func attributeServer(f *Footprint, s FootprintSample) bool {
	server, ok := classifyServer(s.Command)
	if ok {
		f.ServerRSS[server] += s.RSS
	}
	return ok
}

func attributeStack(f *Footprint, s FootprintSample, stackOf map[int]int) bool {
	root, ok := stackOf[s.PID]
	if ok {
		f.StackRSS[root] += s.RSS
	}
	return ok
}

func attributeDev(f *Footprint, s FootprintSample) bool {
	w, ok := ClassifyWatchedProcess(s.Command)
	if !ok {
		return false
	}
	if w.Class == "claude" {
		f.AgentRSS += s.RSS
		f.AgentCount++
	} else {
		f.ToolingRSS += s.RSS
		f.ToolingCount++
	}
	return true
}

// stackMembership maps every pid that belongs to a stack to its launcher pid:
// the launcher itself, every descendant by parentage, and anything sharing the
// launcher's process group.
func stackMembership(samples []FootprintSample, launcherPIDs []int) map[int]int {
	children := map[int][]int{}
	for _, s := range samples {
		children[s.PPID] = append(children[s.PPID], s.PID)
	}
	stackOf := map[int]int{}
	for _, root := range launcherPIDs {
		claimDescendants(stackOf, children, root)
	}
	launchers := map[int]bool{}
	for _, pid := range launcherPIDs {
		launchers[pid] = true
	}
	for _, s := range samples {
		if _, seen := stackOf[s.PID]; !seen && launchers[s.PGID] {
			stackOf[s.PID] = s.PGID
		}
	}
	return stackOf
}

// claimDescendants walks root's subtree breadth-first, claiming every pid not
// already claimed (a pid can only have one parent, but pid reuse in one sample
// could otherwise loop).
func claimDescendants(stackOf map[int]int, children map[int][]int, root int) {
	queue := []int{root}
	for len(queue) > 0 {
		pid := queue[0]
		queue = queue[1:]
		if _, seen := stackOf[pid]; seen {
			continue
		}
		stackOf[pid] = root
		queue = append(queue, children[pid]...)
	}
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
