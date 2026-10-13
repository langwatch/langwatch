package app

import (
	"os"
	"os/exec"
	"path/filepath"
	"sort"
)

// rushGatePrograms is the programs rush's gate queues: one shim each in its bin
// folder, none while the gate is off. A shim with no runnable rush owns nothing,
// as the launchers fall through to haven then (heavy-run-admission.feature).
func rushGatePrograms() []string {
	if !rushRunnable() {
		return nil
	}
	entries, err := os.ReadDir(filepath.Join(rushRoot(), "gate", "bin"))
	if err != nil {
		return nil
	}
	programs := make([]string, 0, len(entries))
	for _, e := range entries {
		if e.Type().IsRegular() {
			programs = append(programs, e.Name())
		}
	}
	sort.Strings(programs)
	return programs
}

// rushOwnsFunc answers RushOwned's question from one read of the shim folder.
func rushOwnsFunc() func(program string) bool {
	owned := map[string]bool{}
	for _, p := range rushGatePrograms() {
		owned[p] = true
	}
	return func(program string) bool { return owned[program] }
}

// rushRoot is rush's state folder as rush picks it: RUSH_HOME, else
// ~/.config/rush unless only ~/.config/agtop holds a config.json.
func rushRoot() string {
	if d := os.Getenv("RUSH_HOME"); d != "" {
		return d
	}
	home, _ := os.UserHomeDir()
	rush, agtop := filepath.Join(home, ".config", "rush"), filepath.Join(home, ".config", "agtop")
	if !isFile(filepath.Join(rush, "config.json")) && isFile(filepath.Join(agtop, "config.json")) {
		return agtop
	}
	return rush
}

// rushRunnable is whether RUSH_BIN, else rush on PATH, is an executable file.
func rushRunnable() bool {
	path := os.Getenv("RUSH_BIN")
	if path == "" {
		found, err := exec.LookPath("rush")
		if err != nil {
			return false
		}
		path = found
	}
	info, err := os.Stat(path) //nolint:gosec // G703: only stats the caller's own RUSH_BIN or PATH entry
	return err == nil && info.Mode().IsRegular() && info.Mode().Perm()&0o111 != 0
}

func isFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular()
}
