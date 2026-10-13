// Package seedgen plans a seed deterministically: flags become a lazy stream of steps that the task
// and door executors send (design: dev/docs/plans/seed-2026-10-09.md).
package seedgen

import (
	"crypto/sha256"
	"encoding/binary"
	"strconv"
)

// Recipe is the generator's recipe version; changing what a seed draws bumps it (design §13).
const Recipe = "seedgen/1"

// Draws are stateless: every value is sha256(recipe, seed, kind, n, purpose), never crypto/rand.
type Draws struct {
	Seed int64
}

// Uint64 is the draw for one (kind, n, purpose).
func (d Draws) Uint64(kind string, n int64, purpose string) uint64 {
	sum := sha256.Sum256([]byte(Recipe + "\x00" + strconv.FormatInt(d.Seed, 10) + "\x00" + kind + "\x00" +
		strconv.FormatInt(n, 10) + "\x00" + purpose))
	return binary.BigEndian.Uint64(sum[:8])
}

// Float is a draw in [0, 1).
func (d Draws) Float(kind string, n int64, purpose string) float64 {
	return float64(d.Uint64(kind, n, purpose)>>11) / (1 << 53)
}
