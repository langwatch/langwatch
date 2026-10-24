//go:build !unix

package lingua

import (
	"errors"
	"os"
)

// mapFile reads the whole file where mmap is not available.
func mapFile(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	if len(data) == 0 {
		return "", errors.New("empty file")
	}
	return string(data), nil
}
