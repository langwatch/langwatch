package app

import (
	"os"
	"path/filepath"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// detectLayout reads a checkout's layout off the disk. The decision itself is
// domain.DetectLayout; this only answers whether a directory is there.
func detectLayout(worktreeDir string) domain.Layout {
	return domain.DetectLayout(func(rel string) bool {
		info, err := os.Stat(filepath.Join(worktreeDir, filepath.FromSlash(rel)))
		return err == nil && info.IsDir()
	})
}
