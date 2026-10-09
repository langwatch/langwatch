package seedgen

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// Manifest records what a run was asked to seed (design §9.2, §13): flags, anchor, recipe, the
// stream's digest and its counts.
type Manifest struct {
	Recipe string         `json:"recipe"`
	Run    string         `json:"run"`
	Flags  Flags          `json:"flags"`
	Digest string         `json:"digest"`
	Counts map[string]int `json:"counts"`
}

// NewManifest describes the plan.
func NewManifest(plan *Plan) Manifest {
	return Manifest{Recipe: Recipe, Run: plan.Run, Flags: plan.Flags, Digest: plan.Digest(),
		Counts: plan.Estimate().Counts}
}

// Write saves the manifest as manifest.json in dir.
func (m Manifest) Write(dir string) error {
	return writeJSON(filepath.Join(dir, "manifest.json"), m)
}

// writeJSON replaces path atomically, so a crash never leaves half a file.
func writeJSON(path string, value any) error {
	encoded, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return err
	}
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, append(encoded, '\n'), 0o600); err != nil {
		return err
	}
	return os.Rename(temporary, path)
}
