package app

// Test-only handles on the keeper hand-over, for keeper_process_test.go.
var (
	HandOver       = (*Orchestrator).handOver
	KeeperPlanPath = keeperPlanPath
	KeeperPlanFor  = (*Orchestrator).keeperPlan
	ReapDeadStacks = (*Orchestrator).reapDeadStacks
)
