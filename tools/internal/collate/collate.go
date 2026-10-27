// Package collate orders strings the way JS `localeCompare` does in the default locale.
package collate

import "strings"

// punctuationOrder is the CLDR root collation order of ASCII punctuation,
// which sorts before digits, and digits before letters.
const punctuationOrder = "_-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$"

func primaryWeight(r rune) int {
	switch {
	case r == ' ':
		return 1
	case strings.ContainsRune(punctuationOrder, r):
		return 2 + strings.IndexRune(punctuationOrder, r)
	case r >= '0' && r <= '9':
		return 100 + int(r-'0')
	case r >= 'a' && r <= 'z':
		return 200 + int(r-'a')
	case r >= 'A' && r <= 'Z':
		return 200 + int(r-'A')
	}
	return 1000 + int(r)
}

// Compare approximates JS `a.localeCompare(b)` in the default locale for
// ASCII: primary weights over the whole string, then lowercase before
// uppercase. Accents and non-ASCII letters fall back to code point order.
func Compare(a, b string) int {
	left, right := []rune(a), []rune(b)
	for i := 0; i < len(left) && i < len(right); i++ {
		if l, r := primaryWeight(left[i]), primaryWeight(right[i]); l != r {
			return sign(l - r)
		}
	}
	if len(left) != len(right) {
		return sign(len(left) - len(right))
	}
	return caseOrder(left, right)
}

// caseOrder breaks a primary tie of equal length: at the first difference,
// the lowercase letter sorts first.
func caseOrder(left, right []rune) int {
	for i := range left {
		if left[i] == right[i] {
			continue
		}
		if left[i] >= 'a' && left[i] <= 'z' {
			return -1
		}
		return 1
	}
	return 0
}

func sign(n int) int {
	switch {
	case n < 0:
		return -1
	case n > 0:
		return 1
	}
	return 0
}
