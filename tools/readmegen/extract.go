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
	"slices"
	"strings"
)

//go:embed extract/*.mts
var extractorScripts embed.FS

// extractorHome is where the scripts are written for the run: inside the
// architecture enforcer, so `@langwatch/architecture-enforcer` resolves as a
// self-reference and `typescript` from its node_modules.
const extractorHome = "packages/architecture-enforcer"

// extractorParts run one after the other, each a node process writing its half
// of the manifest: at once, their peaks add up on a shared box.
var extractorParts = []string{"facts", "routes"}

// Extract runs the extractor for callers outside readmegen (seedgen coverage).
func Extract(ctx context.Context, root string, log io.Writer) (Manifest, error) {
	return runExtractor(ctx, root, log)
}

// runExtractor writes the embedded extractor into the checkout, runs its parts
// with node's own type stripping, merges their manifests and removes the scripts.
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
	for _, part := range extractorParts {
		if err := runExtractorPart(ctx, root, dir, part, log); err != nil {
			return Manifest{}, err
		}
	}
	var manifest Manifest
	for _, part := range extractorParts {
		if err := decodeManifest(filepath.Join(dir, part+".json"), &manifest); err != nil {
			return Manifest{}, err
		}
	}
	return manifest, nil
}

// extractorHeapMB caps the old space of every isolate a part starts (node
// hands the flag to worker threads too), so a runaway fails alone instead of
// taking the box down. Measured live heaps, about half the caps: a facts
// isolate needs 256-384 MB; routes, which imports the whole api app, 512-640 MB.
var extractorHeapMB = map[string]int{"facts": 768, "routes": 1024}

func runExtractorPart(ctx context.Context, root, dir, part string, log io.Writer) error {
	args, env := extractorInvocation(root, part, os.Environ())
	// #nosec G204 -- fixed program and arguments; the paths are this run's own
	command := exec.CommandContext(ctx, "node", args...)
	command.Dir = dir
	command.Env = env
	command.Stdout = log
	command.Stderr = log
	if err := command.Run(); err != nil {
		return fmt.Errorf("run the extractor (node %s/main.mts %s): %w; out of memory? each isolate's heap "+
			"is capped at %d MB unless NODE_OPTIONS sets --max-old-space-size", extractorHome, part, err, extractorHeapMB[part])
	}
	return nil
}

// extractorInvocation is node's arguments and environment for one part. The
// heap cap goes on the command line, which beats NODE_OPTIONS, so it is left
// off when the caller's NODE_OPTIONS already sets a limit of its own.
func extractorInvocation(root, part string, environ []string) (args, env []string) {
	args = []string{"--experimental-transform-types", "--disable-warning=ExperimentalWarning"}
	if !setsHeapLimit(lookupEnv(environ, "NODE_OPTIONS")) {
		args = append(args, fmt.Sprintf("--max-old-space-size=%d", extractorHeapMB[part]))
	}
	args = append(args, "main.mts", part+".json", root, part)
	env = environ
	if lookupEnv(environ, "NODE_COMPILE_CACHE") == "" {
		// node keys the cache by content, so a warm run skips stripping and compiling unchanged files.
		cache := filepath.Join(root, "node_modules", ".cache", "readmegen", part)
		env = append(slices.Clip(environ), "NODE_COMPILE_CACHE="+cache)
	}
	return args, env
}

// setsHeapLimit reports whether node options name the old-space limit; node
// reads dashes and underscores in V8 flags alike.
func setsHeapLimit(options string) bool {
	return strings.Contains(strings.ReplaceAll(options, "_", "-"), "--max-old-space-size")
}

// lookupEnv is the first value `name` has in `environ`, the one os.Getenv returns.
func lookupEnv(environ []string, name string) string {
	for _, entry := range environ {
		if key, value, ok := strings.Cut(entry, "="); ok && key == name {
			return value
		}
	}
	return ""
}

// readManifest decodes a manifest handed in by --manifest.
func readManifest(file string) (Manifest, error) {
	var manifest Manifest
	err := decodeManifest(file, &manifest)
	return manifest, err
}

// decodeManifest decodes a manifest file over what `into` already holds.
func decodeManifest(file string, into *Manifest) error {
	data, err := os.ReadFile(file) // #nosec G304 -- the extractor's output, or a path the caller named
	if err != nil {
		return err
	}
	if err := json.Unmarshal(data, into); err != nil {
		return fmt.Errorf("decode the extractor manifest: %w", err)
	}
	return nil
}
