package diffkit

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// FindingsWriter appends one JSON-encoded value as a line. An implementation
// must flush before it returns, so a reader tailing the file sees every
// finding as it lands, not only once the run ends.
type FindingsWriter interface {
	WriteLine(value any) error
}

// FileFindingsWriter appends JSON lines to a findings file, fsyncing after
// each write so `tail -f` sees every finding as soon as it is decided.
type FileFindingsWriter struct {
	file *os.File
}

// OpenFindingsFile opens (creating if needed) the findings file at path for
// appending, so a fresh run and a later recapture write to the same file.
func OpenFindingsFile(path string) (*FileFindingsWriter, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return nil, err
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600) // #nosec G304 -- path is this run's own findings file.
	if err != nil {
		return nil, err
	}
	return &FileFindingsWriter{file: file}, nil
}

// WriteLine marshals value as one JSON line and fsyncs before returning.
func (writer *FileFindingsWriter) WriteLine(value any) error {
	encoded, err := json.Marshal(value)
	if err != nil {
		return err
	}
	encoded = append(encoded, '\n')
	if _, err := writer.file.Write(encoded); err != nil {
		return err
	}
	return writer.file.Sync()
}

// Close closes the underlying file.
func (writer *FileFindingsWriter) Close() error {
	return writer.file.Close()
}
