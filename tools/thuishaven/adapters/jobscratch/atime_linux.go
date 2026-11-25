//go:build linux

package jobscratch

import (
	"errors"
	"io"
	"io/fs"
	"os"
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

// readFileNoAtime reads a record file without moving its atime. Linux relatime
// updates the atime of a file read more than a day after it was last read, so
// a plain read made every scanned job look freshly read. O_NOATIME is refused
// for files another user owns; those fall back to a plain read.
func readFileNoAtime(path string) ([]byte, error) {
	f, err := os.OpenFile(path, os.O_RDONLY|syscall.O_NOATIME, 0)
	if errors.Is(err, fs.ErrPermission) {
		return os.ReadFile(path)
	}
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return io.ReadAll(f)
}
