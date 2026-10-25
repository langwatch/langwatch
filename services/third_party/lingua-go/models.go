package lingua

//go:generate go run ./cmd/genmodels -out models.bin

import (
	"math"
	"strings"
)

// modelsBin is cmd/genmodels' output, mapped by LoadModels; empty until then.
var modelsBin string

// ModelsAvailable reports whether LoadModels has mapped the language models.
// Without them every ngram lookup misses and all confidences are zero.
func ModelsAvailable() bool {
	return modelsBin != ""
}

// group is one ngram byte length's sorted fixed-width records:
// the ngram bytes, then a little-endian uint32 index into probs.
type group struct {
	recs   string
	recLen int
	n      int
}

// compactModel is a zero-copy view into modelsBin for one language and ngram length.
type compactModel struct {
	probs  string
	groups [21]group // indexed by ngram byte length
}

// modelIndex maps (ISO 639-1 code, ngram length) to its model. LoadModels
// builds it once and it is never written again.
var modelIndex = map[[3]byte]*compactModel{}

// buildModelIndex reads the index at the head of cmd/genmodels' layout.
func buildModelIndex(blob string) map[[3]byte]*compactModel {
	idx := map[[3]byte]*compactModel{}
	count := int(le32(blob, 0))
	for i := range count {
		h := 4 + 12*i
		key := [3]byte{blob[h], blob[h+1], blob[h+2]}
		off, ln := int(le32(blob, h+4)), int(le32(blob, h+8))
		idx[key] = newCompactModel(blob[off : off+ln])
	}
	return idx
}

func newCompactModel(b string) *compactModel {
	p := int(le32(b, 0))
	cm := &compactModel{probs: b[4 : 4+8*p]}
	g := int(b[4+8*p])
	for j := range g {
		d := 5 + 8*p + 9*j
		l, n, o := int(b[d]), int(le32(b, d+1)), int(le32(b, d+5))
		cm.groups[l] = group{recs: b[o : o+n*(l+4)], recLen: l + 4, n: n}
	}
	return cm
}

func le32(s string, i int) uint32 {
	return uint32(s[i]) | uint32(s[i+1])<<8 | uint32(s[i+2])<<16 | uint32(s[i+3])<<24
}

func le64(s string, i int) uint64 {
	return uint64(le32(s, i)) | uint64(le32(s, i+4))<<32
}

func lookupModel(language Language, ngramLength int) *compactModel {
	iso := strings.ToLower(language.IsoCode639_1().String())
	return modelIndex[[3]byte{iso[0], iso[1], byte(ngramLength)}]
}

// get binary-searches the records of len(s) for s and returns its probability.
func (c *compactModel) get(s string) (float64, bool) {
	if c == nil || len(s) >= len(c.groups) {
		return 0, false
	}
	g := c.groups[len(s)]
	lo, hi := 0, g.n
	for lo < hi {
		mid := int(uint(lo+hi) >> 1)
		if g.recs[mid*g.recLen:mid*g.recLen+len(s)] < s {
			lo = mid + 1
		} else {
			hi = mid
		}
	}
	if lo < g.n && g.recs[lo*g.recLen:lo*g.recLen+len(s)] == s {
		i := int(le32(g.recs, lo*g.recLen+len(s)))
		return math.Float64frombits(le64(c.probs, 8*i)), true
	}
	return 0, false
}
