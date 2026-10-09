package seedgen

import (
	"encoding/json"
	"fmt"
	"maps"
	"os"
	"slices"
)

// Checkpoint is saved after each acked step (design §5.6): every step up to Cursor is acked, Acked
// holds the ones acked out of order above it. Resume skips steps the checkpoint already holds.
type Checkpoint struct {
	Run      string         `json:"run"`
	Cursor   int64          `json:"cursor"`
	Acked    []int64        `json:"acked,omitempty"`
	Refs     Refs           `json:"refs"`
	Counters map[string]int `json:"counters"`
}

// NewCheckpoint starts an empty checkpoint for a run; known holds refs bound before the run
// (storage-seed's fixed private org ids).
func NewCheckpoint(run string, known Refs) *Checkpoint {
	refs := Refs{}
	maps.Copy(refs, known)
	return &Checkpoint{Run: run, Refs: refs, Counters: map[string]int{}}
}

// LoadCheckpoint reads a checkpoint and refuses one written by another run.
func LoadCheckpoint(path, run string) (*Checkpoint, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var checkpoint Checkpoint
	if err := json.Unmarshal(data, &checkpoint); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	if checkpoint.Run != run {
		return nil, fmt.Errorf("%s belongs to run %s, not %s: the flags changed since it was written", path, checkpoint.Run, run)
	}
	if checkpoint.Refs == nil {
		checkpoint.Refs = Refs{}
	}
	if checkpoint.Counters == nil {
		checkpoint.Counters = map[string]int{}
	}
	return &checkpoint, nil
}

// Ack records one acked step, its counter and the refs it minted, and advances the cursor over
// every contiguous ack.
func (c *Checkpoint) Ack(seq int64, counter string, refs map[string]string) {
	if c.Done(seq) {
		return
	}
	maps.Copy(c.Refs, refs)
	c.Counters[counter]++
	index, _ := slices.BinarySearch(c.Acked, seq)
	c.Acked = slices.Insert(c.Acked, index, seq)
	for len(c.Acked) > 0 && c.Acked[0] == c.Cursor+1 {
		c.Cursor, c.Acked = c.Acked[0], c.Acked[1:]
	}
}

// Done says whether a step is already acked, so a resume skips it.
func (c *Checkpoint) Done(seq int64) bool {
	_, found := slices.BinarySearch(c.Acked, seq)
	return seq <= c.Cursor || found
}

// Save writes the checkpoint atomically (CI: the run directory; haven: <stack home>/seed/run.json).
func (c *Checkpoint) Save(path string) error {
	return writeJSON(path, c)
}
