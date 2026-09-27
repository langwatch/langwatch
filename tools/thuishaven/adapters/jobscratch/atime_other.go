//go:build !darwin && !linux

package jobscratch

import (
	"io/fs"
	"os"
	"time"
)

// accessTime has no portable form outside darwin and linux, so it reports
// unknown — which keeps every job that has not reached a terminal state.
func accessTime(fs.FileInfo) (time.Time, bool) { return time.Time{}, false }

// readFileNoAtime reads a record file; atime is not consulted on this platform.
func readFileNoAtime(path string) ([]byte, error) { return os.ReadFile(path) }
