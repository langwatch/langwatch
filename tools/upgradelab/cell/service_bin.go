package cell

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
)

// ensureServiceBinary builds the Go service binary at path when it is missing, from the first of the head
// checkout, this checkout's root and the working directory that holds cmd/service.
func (cell *run) ensureServiceBinary(ctx context.Context, path string) error {
	path, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	if _, err := os.Stat(path); err == nil {
		return nil
	} else if !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	cwd, _ := os.Getwd()
	for _, root := range []string{cell.options.HeadDir, filepath.Join(cwd, "..", ".."), cwd} {
		if _, err := os.Stat(filepath.Join(root, "cmd", "service")); err != nil {
			continue
		}
		if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
			return err
		}
		fmt.Fprintf(os.Stderr, "upgradelab: building the service binary at %s from %s\n", path, root)
		command := exec.CommandContext(ctx, "go", "build", "-tags", "dev", "-o", path, "./cmd/service") // #nosec G204 -- fixed argv.
		command.Dir = root
		if output, err := command.CombinedOutput(); err != nil {
			return fmt.Errorf("build service binary in %s: %w: %s", root, err, tail(output))
		}
		return nil
	}
	return fmt.Errorf("service binary %s is missing and no checkout holds cmd/service", path)
}
