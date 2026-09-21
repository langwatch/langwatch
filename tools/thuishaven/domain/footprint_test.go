package domain

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// @scenario "The hub shows the machine's whole memory picture"
func TestPartitionFootprintAttributesEveryProcessOnce(t *testing.T) {
	samples := []FootprintSample{
		// Stack 100: the launcher plus a supervised child tree. Each child leads
		// its OWN process group (that is how one child is bounced without killing
		// its siblings), so only parentage ties them to the stack.
		{PID: 100, PGID: 100, PPID: 1, RSS: 50, Command: "haven up"},
		{PID: 101, PGID: 101, PPID: 100, RSS: 700, Command: "node vite dev"},
		{PID: 102, PGID: 101, PPID: 101, RSS: 300, Command: "node /x/tsx watch src/server"},
		// Shared servers, each running its own way.
		{PID: 200, PGID: 200, PPID: 1, RSS: 900, Command: "/opt/clickhouse-macos-aarch64 server --config x.yml"},
		{PID: 201, PGID: 201, PPID: 1, RSS: 400, Command: "/opt/homebrew/bin/postgres -D /opt/homebrew/var/postgresql@16"},
		{PID: 202, PGID: 201, PPID: 201, RSS: 60, Command: "postgres: checkpointer"},
		{PID: 203, PGID: 203, PPID: 1, RSS: 30, Command: "redis-server *:6379"},
		{PID: 204, PGID: 204, PPID: 1, RSS: 2400, Command: "/Library/Frameworks/com.apple.Virtualization.VirtualMachine"},
		// Agents and tooling outside any stack tree.
		{PID: 300, PGID: 300, PPID: 1, RSS: 800, Command: "claude --continue"},
		{PID: 301, PGID: 301, PPID: 1, RSS: 2500, Command: "tsgo --lsp"},
		{PID: 302, PGID: 302, PPID: 1, RSS: 150, Command: "node /x/node_modules/vitest/dist/workers/forks.js"},
		// Not dev work: the machine's own slice, in its own bucket.
		{PID: 400, PGID: 400, PPID: 1, RSS: 9999, Command: "/System/Library/CoreServices/Finder.app"},
	}

	f := PartitionFootprint(samples, []int{100})

	assert.Equal(t, int64(1050), f.StackRSS[100])
	assert.Equal(t, int64(900), f.ServerRSS["clickhouse"])
	assert.Equal(t, int64(460), f.ServerRSS["postgres"])
	assert.Equal(t, int64(30), f.ServerRSS["redis"])
	assert.Equal(t, int64(2400), f.ServerRSS["containers"])
	assert.Equal(t, int64(800), f.AgentRSS)
	assert.Equal(t, 1, f.AgentCount)
	assert.Equal(t, int64(2650), f.ToolingRSS)
	assert.Equal(t, 2, f.ToolingCount)
	assert.Equal(t, int64(9999), f.OtherRSS)
	assert.Equal(t, 1, f.OtherCount)
	// Every byte lands in exactly one bucket.
	assert.Equal(t, int64(1050+900+460+30+2400+800+2650), f.DevRSS())
	assert.Equal(t, f.DevRSS()+9999, f.TotalRSS())
}

// @scenario "A stack is charged its whole process tree, not just its launcher"
func TestPartitionFootprintChargesTheWholeTree(t *testing.T) {
	// The regression this pins: supervised children lead their own process
	// groups, so a group-based sum saw only the ~20MB launcher and reported a
	// multi-GB stack as costing nothing.
	samples := []FootprintSample{
		{PID: 100, PGID: 100, PPID: 1, RSS: 20, Command: "haven up"},
		{PID: 101, PGID: 101, PPID: 100, RSS: 4000, Command: "node vite dev"},
		{PID: 102, PGID: 102, PPID: 100, RSS: 1500, Command: "/usr/local/bin/service nlpgo"},
		{PID: 103, PGID: 101, PPID: 101, RSS: 800, Command: "node worker"},
		// A claude agent inside the tree is the stack's own work, even though
		// its command matches the agent bucket.
		{PID: 104, PGID: 104, PPID: 100, RSS: 200, Command: "claude -p something"},
	}

	f := PartitionFootprint(samples, []int{100})

	assert.Equal(t, int64(20+4000+1500+800+200), f.StackRSS[100])
	assert.Zero(t, f.AgentRSS)
	assert.Zero(t, f.ToolingRSS)
}

func TestPartitionFootprintServersAreNeverChargedToAStack(t *testing.T) {
	// haven spawns the native ClickHouse detached from a launcher, so it can sit
	// inside a stack's tree — but it serves every worktree, so it stays a server.
	samples := []FootprintSample{
		{PID: 100, PGID: 100, PPID: 1, RSS: 20, Command: "haven up"},
		{PID: 105, PGID: 105, PPID: 100, RSS: 3000, Command: "/opt/clickhouse server"},
	}

	f := PartitionFootprint(samples, []int{100})

	assert.Equal(t, int64(3000), f.ServerRSS["clickhouse"])
	assert.Equal(t, int64(20), f.StackRSS[100])
}

func TestPartitionFootprintListsEveryLauncherEvenWhenIdle(t *testing.T) {
	f := PartitionFootprint(nil, []int{100, 200})
	assert.Len(t, f.StackRSS, 2)
	assert.Zero(t, f.StacksRSS())
}
