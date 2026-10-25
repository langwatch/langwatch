//go:build unix

package lingua

import (
	"errors"
	"os"
	"syscall"
	"unsafe"
)

// mapFile maps the file read-only; the pages stay shared and evictable, as
// read-only data in the binary would be. The mapping lives for the process.
func mapFile(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return "", err
	}
	if info.Size() == 0 {
		return "", errors.New("empty file")
	}
	data, err := syscall.Mmap(int(f.Fd()), 0, int(info.Size()), syscall.PROT_READ, syscall.MAP_SHARED)
	if err != nil {
		return "", err
	}
	return unsafe.String(&data[0], len(data)), nil
}
