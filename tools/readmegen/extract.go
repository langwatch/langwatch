package readmegen

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path"
	"path/filepath"
)

//go:embed extract/*.mts
var extractorScripts embed.FS

// extractorHome is where the scripts are written for the run: inside the
// architecture enforcer, so `@langwatch/architecture-enforcer` resolves as a
// self-reference and `typescript` from its node_modules, as apidiff writes its
// inventory into packages/api.
const extractorHome = "packages/architecture-enforcer"

// runExtractor writes the embedded extractor into the checkout, runs it with
// node's own type stripping, decodes its manifest and removes the scripts.
func runExtractor(ctx context.Context, root string, log io.Writer) (Manifest, error) {
	dir, err := os.MkdirTemp(filepath.Join(root, filepath.FromSlash(extractorHome)), ".readmegen-")
	if err != nil {
		return Manifest{}, fmt.Errorf("prepare the extractor: %w", err)
	}
	defer os.RemoveAll(dir)
	entries, err := extractorScripts.ReadDir("extract")
	if err != nil {
		return Manifest{}, err
	}
	for _, entry := range entries {
		source, err := extractorScripts.ReadFile(path.Join("extract", entry.Name()))
		if err != nil {
			return Manifest{}, err
		}
		if err := os.WriteFile(filepath.Join(dir, entry.Name()), source, 0o600); err != nil {
			return Manifest{}, err
		}
	}
	out := filepath.Join(dir, "manifest.json")
	// #nosec G204 -- fixed program and arguments; the paths are this run's own
	command := exec.CommandContext(ctx, "node", "--experimental-transform-types",
		"--disable-warning=ExperimentalWarning", "main.mts", out, root)
	command.Dir = dir
	command.Stdout = log
	command.Stderr = log
	if err := command.Run(); err != nil {
		return Manifest{}, fmt.Errorf("run the extractor (node %s/main.mts): %w", extractorHome, err)
	}
	return readManifest(out)
}

// readManifest decodes a manifest the extractor wrote, or one handed in by --manifest.
func readManifest(file string) (Manifest, error) {
	data, err := os.ReadFile(file) // #nosec G304 -- the extractor's output, or a path the caller named
	if err != nil {
		return Manifest{}, err
	}
	var manifest Manifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return Manifest{}, fmt.Errorf("decode the extractor manifest: %w", err)
	}
	return manifest, nil
}
