package rules

import (
	"encoding/json"
	"errors"
	"math"
	"strconv"
	"strings"
	"unicode"
)

// ExactMatchSettings are langevals' ExactMatchSettings.
type ExactMatchSettings struct {
	CaseSensitive     bool `json:"case_sensitive"`
	TrimWhitespace    bool `json:"trim_whitespace"`
	RemovePunctuation bool `json:"remove_punctuation"`
}

// DefaultExactMatchSettings are the Python defaults.
func DefaultExactMatchSettings() ExactMatchSettings {
	return ExactMatchSettings{CaseSensitive: false, TrimWhitespace: true, RemovePunctuation: true}
}

// ParseExactMatchSettings overlays raw settings on the defaults. Absent or
// null settings are the defaults; a non-boolean value is refused.
func ParseExactMatchSettings(raw json.RawMessage) (ExactMatchSettings, error) {
	settings := DefaultExactMatchSettings()
	if len(raw) == 0 || string(raw) == "null" {
		return settings, nil
	}
	if err := json.Unmarshal(raw, &settings); err != nil {
		return settings, errors.New("exact_match settings must be an object of booleans")
	}
	return settings, nil
}

// ExactMatch ports langevals_langevals/exact_match.py: the float
// short-circuit, then JavaScript loose equality, then the transform chain.
// Details are the Python evaluator's, verbatim.
func ExactMatch(output, expected string, settings ExactMatchSettings) (passed bool, details string) {
	left, leftIsFloat := pyFloat(output)
	right, rightIsFloat := pyFloat(expected)
	if leftIsFloat && rightIsFloat {
		if left == right {
			return true, output + " == " + expected
		}
		return false, "Expected " + output + " to be equal to " + expected
	}
	if jsLooseEqual(output, expected) {
		return true, output + " == " + expected
	}

	if settings.TrimWhitespace {
		output = strings.TrimFunc(output, pyIsSpace)
		expected = strings.TrimFunc(expected, pyIsSpace)
	}
	if settings.RemovePunctuation {
		output = strings.Map(keepAlnumOrSpace, output)
		expected = strings.Map(keepAlnumOrSpace, expected)
	}
	// ponytail: Go's ToLower has no Final_Sigma rule; add one if Greek parity matters.
	if !settings.CaseSensitive {
		output = strings.ToLower(output)
		expected = strings.ToLower(expected)
	}
	if output == expected {
		return true, output + " == " + expected
	}
	return false, "Expected:\n\t\"" + output + "\"\n\nTo be exactly equal to:\n\t\"" + expected + "\""
}

// jsLooseEqual is _js_loose_equal: recover each side's JSON scalar, then
// compare as numbers when both sides are numeric, booleans counting 1 and 0.
func jsLooseEqual(a, b string) bool {
	left, leftOK := looseNumber(a)
	right, rightOK := looseNumber(b)
	return leftOK && rightOK && left == right
}

// looseNumber is _to_number(_try_json(text)). JSON's NaN and Infinity, which
// Go's decoder refuses, fall back to the text and still parse as floats.
func looseNumber(text string) (float64, bool) {
	var value any
	if err := json.Unmarshal([]byte(text), &value); err != nil {
		return pyFloat(text)
	}
	switch v := value.(type) {
	case bool:
		if v {
			return 1, true
		}
		return 0, true
	case float64:
		return v, true
	case string:
		return pyFloat(v)
	default:
		return 0, false
	}
}

// pyFloat is Python's float(str) for ASCII input: surrounding whitespace,
// single underscores between digits, inf, infinity and nan with a sign, no
// hex. ponytail: non-ASCII digits are refused; Python accepts them.
func pyFloat(text string) (float64, bool) {
	s := strings.TrimFunc(text, pyIsSpace)
	unsigned := strings.TrimLeft(s, "+-")
	if len(s)-len(unsigned) > 1 || unsigned == "" {
		return 0, false
	}
	lower := strings.ToLower(unsigned)
	if lower == "nan" {
		return math.NaN(), true
	}
	if strings.HasPrefix(lower, "0x") || strings.ContainsAny(lower, "px") {
		return 0, false
	}
	if strings.Contains(s, "_") {
		if !underscoresBetweenDigits(s) {
			return 0, false
		}
		s = strings.ReplaceAll(s, "_", "")
	}
	value, err := strconv.ParseFloat(s, 64)
	if err != nil && !errors.Is(err, strconv.ErrRange) {
		return 0, false
	}
	return value, true
}

func underscoresBetweenDigits(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] != '_' {
			continue
		}
		if i == 0 || i == len(s)-1 || !isASCIIDigit(s[i-1]) || !isASCIIDigit(s[i+1]) {
			return false
		}
	}
	return true
}

func isASCIIDigit(c byte) bool { return c >= '0' && c <= '9' }

// pyIsSpace is str.isspace: Go's White_Space set plus the four ASCII
// separators (0x1C-0x1F) Python also counts.
func pyIsSpace(r rune) bool {
	return unicode.IsSpace(r) || (r >= 0x1c && r <= 0x1f)
}

// keepAlnumOrSpace keeps what str.isalnum() or str.isspace() accepts.
func keepAlnumOrSpace(r rune) rune {
	if unicode.IsLetter(r) || unicode.IsNumber(r) || pyIsSpace(r) {
		return r
	}
	return -1
}
