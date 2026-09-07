//go:build !darwin && !linux

package jobscratch

import (
	"io/fs"
	"time"
)

// accessTime has no portable form outside darwin and linux, so it reports
// unknown — which keeps every job that has not reached a terminal state.
func accessTime(fs.FileInfo) (time.Time, bool) { return time.Time{}, false }
