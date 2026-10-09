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
	"sync"
)

//go:embed extract/*.mts
var extractorScripts embed.FS

// extractorHome is where the scripts are written for the run: inside the
// architecture enforcer, so `@langwatch/architecture-enforcer` resolves as a
// self-reference and `typescript` from its node_modules, as apidiff writes its
// inventory into packages/api.
const extractorHome = "packages/architecture-enforcer"

// extractorParts run as two node processes at once; each writes its half of the manifest.
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
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	log = &lockedWriter{w: log}
	done := make(chan error, len(extractorParts))
	for _, part := range extractorParts {
		go func() { done <- runExtractorPart(ctx, root, dir, part, log) }()
	}
	for range extractorParts {
		if partErr := <-done; partErr != nil && err == nil {
			err = partErr
			cancel()
		}
	}
	if err != nil {
		return Manifest{}, err
	}
	var manifest Manifest
	for _, part := range extractorParts {
		if err := decodeManifest(filepath.Join(dir, part+".json"), &manifest); err != nil {
			return Manifest{}, err
		}
	}
	return manifest, nil
}

func runExtractorPart(ctx context.Context, root, dir, part string, log io.Writer) error {
	// #nosec G204 -- fixed program and arguments; the paths are this run's own
	command := exec.CommandContext(ctx, "node", "--experimental-transform-types",
		"--disable-warning=ExperimentalWarning", "main.mts", part+".json", root, part)
	command.Dir = dir
	command.Env = os.Environ()
	if os.Getenv("NODE_COMPILE_CACHE") == "" {
		// node keys the cache by content, so a warm run skips stripping and compiling unchanged files.
		cache := filepath.Join(root, "node_modules", ".cache", "readmegen", part)
		command.Env = append(command.Env, "NODE_COMPILE_CACHE="+cache)
	}
	command.Stdout = log
	command.Stderr = log
	if err := command.Run(); err != nil {
		return fmt.Errorf("run the extractor (node %s/main.mts %s): %w", extractorHome, part, err)
	}
	return nil
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

// lockedWriter lets both extractor processes share one log.
type lockedWriter struct {
	mu sync.Mutex
	w  io.Writer
}

func (l *lockedWriter) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.w.Write(p)
}
