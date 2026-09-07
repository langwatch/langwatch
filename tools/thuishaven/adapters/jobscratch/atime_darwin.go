//go:build darwin

package jobscratch

import (
	"io/fs"
	"syscall"
	"time"
)

// accessTime reads a file's atime from the darwin stat block. Where the syscall
// shape is not what we expect it reports unknown, and an unknown access time
// keeps the job: ClassifyJob reclaims on age only when both timestamps are known
// and old.
func accessTime(info fs.FileInfo) (time.Time, bool) {
	st, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return time.Time{}, false
	}
	return time.Unix(st.Atimespec.Sec, st.Atimespec.Nsec), true
}
