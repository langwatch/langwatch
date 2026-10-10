package visualdiff

import (
	"io"
	"time"

	"github.com/langwatch/langwatch/tools/diffkit"
)

// newStampedWriter moved to tools/diffkit; kept as a thin wrapper so this
// package and its tests read the same name.
func newStampedWriter(out io.Writer, now func() time.Time) *diffkit.StampedWriter {
	return diffkit.NewStampedWriter(out, now)
}
