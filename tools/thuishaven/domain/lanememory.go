package domain

// The stack lanes' memory ceilings: a lane whose process group grows past its
// ceiling is killed and restarted by its supervisor, never left to take the machine.
const (
	LimitUILaneMemory     = "ui-lane-memory-mb"
	LimitAPILaneMemory    = "api-lane-memory-mb"
	LimitWorkerLaneMemory = "worker-lane-memory-mb"

	UILaneMemoryEnv     = "HAVEN_UI_MAX_RSS_MB"
	APILaneMemoryEnv    = "HAVEN_API_MAX_RSS_MB"
	WorkerLaneMemoryEnv = "HAVEN_WORKER_MAX_RSS_MB"

	DefaultUILaneMemoryMB     = 2048
	DefaultAPILaneMemoryMB    = 2560
	DefaultWorkerLaneMemoryMB = 2560
)

// LaneMemoryCaps is each Node lane's ceiling in MB; 0 is no ceiling.
type LaneMemoryCaps struct {
	UIMB, APIMB, WorkerMB int
}

// UIBytes is the Vite ui lane's ceiling.
func (c LaneMemoryCaps) UIBytes() int64 { return int64(c.UIMB) << 20 }

// BackendBytes is the ceiling of a lane running the api and the worker in one
// process: the sum of both, and none when either is uncapped.
func (c LaneMemoryCaps) BackendBytes() int64 {
	if c.APIMB <= 0 || c.WorkerMB <= 0 {
		return 0
	}
	return int64(c.APIMB+c.WorkerMB) << 20
}
