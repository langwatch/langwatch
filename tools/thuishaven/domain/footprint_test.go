package domain

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// @scenario "The hub shows the machine's whole memory picture"
func TestPartitionFootprintAttributesEveryProcessOnce(t *testing.T) {
	samples := []FootprintSample{
		// Stack 100: launcher + two supervised services in its group.
		{PID: 100, PGID: 100, RSS: 50, Command: "node scripts/dev.mjs"},
		{PID: 101, PGID: 100, RSS: 700, Command: "node vite dev"},
		{PID: 102, PGID: 100, RSS: 300, Command: "/usr/local/bin/service nlpgo"},
		// Shared servers, each running its own way.
		{PID: 200, PGID: 200, RSS: 900, Command: "/opt/clickhouse-macos-aarch64 server --config x.yml"},
		{PID: 201, PGID: 201, RSS: 400, Command: "/opt/homebrew/bin/postgres -D /opt/homebrew/var/postgresql@16"},
		{PID: 202, PGID: 201, RSS: 60, Command: "postgres: checkpointer"},
		{PID: 203, PGID: 203, RSS: 30, Command: "redis-server *:6379"},
		{PID: 204, PGID: 204, RSS: 2400, Command: "/Library/Frameworks/com.apple.Virtualization.VirtualMachine"},
		// Agents and tooling outside any stack group.
		{PID: 300, PGID: 300, RSS: 800, Command: "claude --continue"},
		{PID: 301, PGID: 301, RSS: 2500, Command: "tsgo --lsp"},
		{PID: 302, PGID: 302, RSS: 150, Command: "node /x/node_modules/vitest/dist/workers/forks.js"},
		// Not dev work: never attributed anywhere.
		{PID: 400, PGID: 400, RSS: 9999, Command: "/System/Library/CoreServices/Finder.app"},
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
	// Every attributed byte lands in exactly one bucket, and Finder in none.
	assert.Equal(t, int64(1050+900+460+30+2400+800+2650), f.TotalRSS())
}

// @scenario "A stack's own processes are never misfiled as tooling"
func TestPartitionFootprintGroupMembershipWins(t *testing.T) {
	samples := []FootprintSample{
		// A claude agent AND a node process inside the stack's group: both are
		// the stack's own work, even though their commands match other buckets.
		{PID: 101, PGID: 100, RSS: 500, Command: "node vite dev"},
		{PID: 102, PGID: 100, RSS: 200, Command: "claude -p something"},
	}

	f := PartitionFootprint(samples, []int{100})

	assert.Equal(t, int64(700), f.StackRSS[100])
	assert.Zero(t, f.AgentRSS)
	assert.Zero(t, f.ToolingRSS)
}

func TestPartitionFootprintListsEveryLauncherEvenWhenIdle(t *testing.T) {
	f := PartitionFootprint(nil, []int{100, 200})
	assert.Len(t, f.StackRSS, 2)
	assert.Zero(t, f.StacksRSS())
}
