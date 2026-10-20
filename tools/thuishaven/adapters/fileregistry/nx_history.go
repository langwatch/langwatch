package fileregistry

import (
	"os"
	"path/filepath"
	"strings"
	"syscall"
)

// NxHistoryCap is how many Nx task rows nx-history.jsonl keeps, newest last.
// The file sits beside run-history.jsonl but feeds no wait estimate.
const NxHistoryCap = 5000

func (s *Store) nxHistoryPath() string { return filepath.Join(s.home, "nx-history.jsonl") }

// AppendNxHistory adds rows (one JSON object each, no newline) to the Nx task
// history under its own lock and rewrites the file atomically, keeping the
// newest NxHistoryCap rows, the same way AppendRunHistory keeps run-history.
func (s *Store) AppendNxHistory(rows []string) error {
	if err := os.MkdirAll(s.home, 0o750); err != nil {
		return err
	}
	release, err := s.lockNxHistory()
	if err != nil {
		return err
	}
	defer release()

	all := append(s.NxHistory(), rows...)
	if len(all) > NxHistoryCap {
		all = all[len(all)-NxHistoryCap:]
	}
	return writeFileAtomic(s.nxHistoryPath(), []byte(strings.Join(all, "\n")+"\n"), 0o644)
}

// NxHistory reads the rows newest-last. Absent or unreadable is empty.
func (s *Store) NxHistory() []string {
	b, err := os.ReadFile(s.nxHistoryPath())
	if err != nil {
		return nil
	}
	var out []string
	for _, line := range strings.Split(string(b), "\n") {
		if line = strings.TrimSpace(line); line != "" {
			out = append(out, line)
		}
	}
	return out
}

// lockNxHistory is lockRunHistory's pattern: the writer renames a fresh file
// over the path, so the lock is a file of its own.
func (s *Store) lockNxHistory() (func(), error) {
	f, err := os.OpenFile(s.nxHistoryPath()+".lock", os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX); err != nil {
		_ = f.Close()
		return nil, err
	}
	return func() {
		_ = syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
		_ = f.Close()
	}, nil
}
