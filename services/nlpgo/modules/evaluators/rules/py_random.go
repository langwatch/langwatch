package rules

import "math/bits"

const (
	mtSize  = 624
	mtShift = 397
)

// pyRandom is CPython's random.Random over MT19937, seeded with an int as
// random.seed(int) does (init_by_array over the 32-bit words of abs(seed)).
type pyRandom struct {
	state [mtSize]uint32
	index int
}

func newPyRandom(seed int) *pyRandom {
	magnitude := uint64(seed)
	if seed < 0 {
		magnitude = -magnitude
	}
	key := []uint32{uint32(magnitude)}
	if high := uint32(magnitude >> 32); high != 0 {
		key = append(key, high)
	}
	r := &pyRandom{index: mtSize}
	r.initByArray(key)
	return r
}

func (r *pyRandom) initGenrand(seed uint32) {
	r.state[0] = seed
	for i := uint32(1); i < mtSize; i++ {
		prev := r.state[i-1]
		r.state[i] = 1812433253*(prev^(prev>>30)) + i
	}
}

func (r *pyRandom) initByArray(key []uint32) {
	r.initGenrand(19650218)
	i, j := 1, 0
	for k := max(mtSize, len(key)); k > 0; k-- {
		prev := r.state[i-1]
		r.state[i] = (r.state[i] ^ ((prev ^ (prev >> 30)) * 1664525)) + key[j] + uint32(j)
		i, j = i+1, j+1
		if i >= mtSize {
			r.state[0] = r.state[mtSize-1]
			i = 1
		}
		if j >= len(key) {
			j = 0
		}
	}
	for k := mtSize - 1; k > 0; k-- {
		prev := r.state[i-1]
		r.state[i] = (r.state[i] ^ ((prev ^ (prev >> 30)) * 1566083941)) - uint32(i)
		i++
		if i >= mtSize {
			r.state[0] = r.state[mtSize-1]
			i = 1
		}
	}
	r.state[0] = 0x80000000
}

func (r *pyRandom) twist() {
	for i := range mtSize {
		y := (r.state[i] & 0x80000000) | (r.state[(i+1)%mtSize] & 0x7fffffff)
		next := r.state[(i+mtShift)%mtSize] ^ (y >> 1)
		if y&1 != 0 {
			next ^= 0x9908b0df
		}
		r.state[i] = next
	}
	r.index = 0
}

func (r *pyRandom) uint32() uint32 {
	if r.index >= mtSize {
		r.twist()
	}
	y := r.state[r.index]
	r.index++
	y ^= y >> 11
	y ^= (y << 7) & 0x9d2c5680
	y ^= (y << 15) & 0xefc60000
	return y ^ (y >> 18)
}

// randBelow is Random._randbelow_with_getrandbits: k random bits until one is
// below n.
func (r *pyRandom) randBelow(n int) int {
	k := bits.Len(uint(n))
	for {
		if v := int(r.uint32() >> (32 - k)); v < n {
			return v
		}
	}
}

// PyShuffle is random.Random(seed).shuffle(items), in place: the same
// permutation Python draws for the same int seed. Lists under 2^32 items.
func PyShuffle[T any](seed int, items []T) {
	r := newPyRandom(seed)
	for i := len(items) - 1; i >= 1; i-- {
		j := r.randBelow(i + 1)
		items[i], items[j] = items[j], items[i]
	}
}
