package snapshot

import (
	"fmt"
	"hash/fnv"
	"slices"
	"strconv"
	"strings"
)

// TableFingerprint is a table's row count and the XOR of a 64-bit hash of each row's key
// columns, so it does not depend on the order rows were written or read in (plan §5.2).
type TableFingerprint struct {
	Count int64  `json:"count"`
	Hash  string `json:"hash"`
}

// Fingerprint maps a store ("postgres", "clickhouse/<target>", "redis") to its tables.
type Fingerprint map[string]map[string]TableFingerprint

// Diff lists every table whose count or hash differs, sorted; empty means equal.
func (fingerprint Fingerprint) Diff(other Fingerprint) []string {
	var diffs []string
	for store := range union(fingerprint, other) {
		for table := range union(fingerprint[store], other[store]) {
			diffs = append(diffs, diffTable(store+"/"+table, lookup(fingerprint[store], table), lookup(other[store], table))...)
		}
	}
	slices.Sort(diffs)
	return diffs
}

func union[V any](a, b map[string]V) map[string]bool {
	keys := map[string]bool{}
	for key := range a {
		keys[key] = true
	}
	for key := range b {
		keys[key] = true
	}
	return keys
}

func lookup(tables map[string]TableFingerprint, table string) *TableFingerprint {
	if found, ok := tables[table]; ok {
		return &found
	}
	return nil
}

func diffTable(name string, a, b *TableFingerprint) []string {
	switch {
	case a == nil || b == nil:
		return []string{name + ": present on one side only"}
	case *a != *b:
		return []string{fmt.Sprintf("%s: count %d vs %d, hash %s vs %s", name, a.Count, b.Count, a.Hash, b.Hash)}
	}
	return nil
}

// FoldRows fingerprints rows client-side (Redis keys, fakes); servers fold with their own hash.
func FoldRows(rows [][]string) TableFingerprint {
	var xor uint64
	for _, row := range rows {
		hash := fnv.New64a()
		_, _ = hash.Write([]byte(strings.Join(row, "\x1f")))
		xor ^= hash.Sum64()
	}
	return TableFingerprint{Count: int64(len(rows)), Hash: formatHash(xor)}
}

func formatHash(value uint64) string { return fmt.Sprintf("%016x", value) }

// parseServerHash reads a server's XOR result (signed or unsigned decimal) into the hex form.
func parseServerHash(text string) (string, error) {
	if unsigned, err := strconv.ParseUint(text, 10, 64); err == nil {
		return formatHash(unsigned), nil
	}
	signed, err := strconv.ParseInt(text, 10, 64)
	if err != nil {
		return "", fmt.Errorf("fingerprint hash %q: %w", text, err)
	}
	return formatHash(uint64(signed)), nil
}
