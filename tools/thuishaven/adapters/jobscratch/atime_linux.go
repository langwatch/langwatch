//go:build linux

package jobscratch

import (
	"io/fs"
	"syscall"
	"time"
)

// accessTime reads a file's atime from the linux stat block. See the darwin
// twin: an unknown access time keeps the job.
func accessTime(info fs.FileInfo) (time.Time, bool) {
	st, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return time.Time{}, false
	}
	return time.Unix(st.Atim.Sec, st.Atim.Nsec), true
}
