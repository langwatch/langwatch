// Package jsstr provides string helpers with JavaScript String semantics,
// where length and slicing count UTF-16 code units rather than bytes.
package jsstr

import "unicode/utf8"

// Len returns the JavaScript String#length of s: its UTF-16 code unit count.
func Len(s string) int {
	n := 0
	for i := 0; i < len(s); {
		c := s[i]
		if c < utf8.RuneSelf {
			n++
			i++
			continue
		}
		r, size := utf8.DecodeRuneInString(s[i:])
		i += size
		if r >= 0x10000 {
			n += 2
		} else {
			n++
		}
	}
	return n
}

// Prefix returns the longest prefix of s holding at most n UTF-16 code units,
// like s.slice(0, n) in JavaScript (a split surrogate pair is dropped).
func Prefix(s string, n int) string {
	units := 0
	for i := 0; i < len(s); {
		c := s[i]
		if c < utf8.RuneSelf {
			if units+1 > n {
				return s[:i]
			}
			units++
			i++
			continue
		}
		r, size := utf8.DecodeRuneInString(s[i:])
		w := 1
		if r >= 0x10000 {
			w = 2
		}
		if units+w > n {
			return s[:i]
		}
		units += w
		i += size
	}
	return s
}

// Slice returns the part of s between the UTF-16 code unit indexes start and
// end, like s.slice(start, end) in JavaScript for 0 <= start <= end. A
// surrogate pair split at either end is dropped.
func Slice(s string, start, end int) string {
	from := len(s) - len(skipUnits(s, start))
	to := len(Prefix(s, end))
	if from >= to {
		return ""
	}
	return s[from:to]
}

// skipUnits returns s after its first n UTF-16 code units, rounding up past
// a surrogate pair split at n.
func skipUnits(s string, n int) string {
	units := 0
	for i := 0; i < len(s); {
		if units >= n {
			return s[i:]
		}
		c := s[i]
		if c < utf8.RuneSelf {
			units++
			i++
			continue
		}
		r, size := utf8.DecodeRuneInString(s[i:])
		if r >= 0x10000 {
			units += 2
		} else {
			units++
		}
		i += size
	}
	return ""
}
