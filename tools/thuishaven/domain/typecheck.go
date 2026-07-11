package domain

// TypecheckSlots decides how many concurrent tsgo typechecks may run across all
// worktrees on this machine. A tsgo run is memory-hungry (~3-4 GiB peak on this
// codebase), so parallel `pnpm typecheck` across worktrees is what exhausts RAM.
// An explicit override wins; otherwise we bound by memory (one slot per ~4 GiB)
// and never exceed the CPU count. At least one slot always.
func TypecheckSlots(totalRAMBytes uint64, numCPU, override int) int {
	if override > 0 {
		return override
	}
	const perRun = uint64(4) << 30 // 4 GiB budget per typecheck
	slots := 1
	if totalRAMBytes >= perRun {
		slots = int(totalRAMBytes / perRun)
	}
	if numCPU > 0 && slots > numCPU {
		slots = numCPU
	}
	if slots < 1 {
		slots = 1
	}
	return slots
}
