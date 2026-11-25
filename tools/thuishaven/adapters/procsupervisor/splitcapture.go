package procsupervisor

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/app"
)

// A Node host lane (dev-runtime's one-process app lane, or the api lane with the
// backend split) runs the ui, the api and the worker in one process. Capturing
// it per application is what lets `haven logs worker`, `haven errors` and the
// console's service list name the application rather than the process hosting it.

// backendApps are the halves a launcher or supervisor line belongs to: either
// may be the one that crashed, so neither view may hide it.
var backendApps = []string{"api", "worker"}

// capture writes one lane's lines to its capture file, or, for a split lane, to
// each application's file the line belongs to. nil captures nothing.
type capture struct {
	lane  string
	split bool
	sinks map[string]*logSink
}

func newCapture(ac app.Child, since time.Time) *capture {
	if ac.LogPath == "" {
		return nil
	}
	if !ac.SplitLog {
		return &capture{lane: ac.Name, sinks: map[string]*logSink{ac.Name: newLogSinkSince(ac.LogPath, since)}}
	}
	dir := filepath.Dir(ac.LogPath)
	if ac.Name != app.APILane {
		// The whole-lane capture an earlier up wrote would list beside its own split.
		_ = os.Rename(ac.LogPath, ac.LogPath+".1")
	}
	sinks := map[string]*logSink{}
	for _, name := range []string{"ui", "api", "worker"} {
		sinks[name] = newLogSinkSince(filepath.Join(dir, name+".log"), since)
	}
	return &capture{lane: ac.Name, split: true, sinks: sinks}
}

// write captures one line. launcher marks the supervisor's own lines.
func (c *capture) write(line string, launcher bool) {
	if c == nil {
		return
	}
	if !c.split {
		c.sinks[c.lane].writeLine(line)
		return
	}
	at := time.Now()
	for _, name := range c.apps(line, launcher) {
		c.sinks[name].writeLineAt(at, line)
	}
}

// apps is which applications' captures a line of a split lane goes to: the one
// its record names, both backend halves for a launcher line, the ui for plain
// build output, and every one for a raw crash dump.
func (c *capture) apps(line string, launcher bool) []string {
	if launcher {
		return backendApps
	}
	var owner struct {
		Name    string `json:"name"`
		Service string `json:"service"`
	}
	trimmed := strings.TrimSpace(line)
	if !strings.HasPrefix(trimmed, "{") || json.Unmarshal([]byte(trimmed), &owner) != nil {
		switch {
		case c.lane != app.AppLane:
			return backendApps
		case crashLine.MatchString(line):
			return []string{"ui", "api", "worker"}
		}
		return []string{"ui"}
	}
	switch {
	case owner.Service == "langwatch-worker", strings.HasPrefix(owner.Name, "langwatch:worker"):
		return []string{"worker"}
	case owner.Service == "langwatch-api", strings.HasPrefix(owner.Name, "langwatch:api"), strings.HasPrefix(owner.Name, "langwatch-api"):
		return []string{"api"}
	case owner.Service == "langwatch-ui" && c.lane == app.AppLane:
		return []string{"ui"}
	}
	return backendApps
}
