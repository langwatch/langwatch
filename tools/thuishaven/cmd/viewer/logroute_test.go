package viewer

import "testing"

// @scenario "The two applications the api lane hosts are addressable by name"
func TestRouteLineSplitsTheBackendLaneByTheHalfThatWrote(t *testing.T) {
	// A half that dies before its first log line has no logger to name, so its
	// failure record names the process instead. Routing that by the lane's
	// default filed the worker's own boot failure under the api.
	t.Run("when a half's failure record names the process, it routes to that half", func(t *testing.T) {
		line := `{"level":"fatal","service":"langwatch-worker","msg":"fatal boot failure"}`
		if app := RouteLine("backend", line, ""); app != "worker" {
			t.Errorf("RouteLine = %q, want worker — the half its own record names", app)
		}
	})

	t.Run("when the api half names itself, it routes to the api", func(t *testing.T) {
		line := `{"level":"info","service":"langwatch-api","msg":"listening"}`
		if app := RouteLine("backend", line, ""); app != "api" {
			t.Errorf("RouteLine = %q, want api", app)
		}
	})

	// The launcher hosts both halves, so its own lines belong to neither. They
	// fall to the lane's default rather than being read as one half's.
	t.Run("when the launcher itself writes, the line stays on the lane's default", func(t *testing.T) {
		line := `{"level":"warn","service":"langwatch-backend","msg":"exited — restarting in 1s"}`
		if app := RouteLine("backend", line, ""); app != LaneDefaultApp("backend") {
			t.Errorf("RouteLine = %q, want the lane default — the launcher is neither half", app)
		}
	})

	t.Run("when the line is a stack frame, it follows the record above it", func(t *testing.T) {
		if app := RouteLine("backend", "    at startWorker (main.ts:33)", "worker"); app != "worker" {
			t.Errorf("RouteLine = %q, want worker — a trace must not be torn off its error", app)
		}
	})
}
