package rules

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
)

// RagasExtractJSON is ragas' extract_json: from a ```json marker when there
// is one, the first balanced {...} or [...], counting only that pair's
// characters; the text unchanged when there is none or it never balances.
func RagasExtractJSON(text string) string {
	if at := strings.Index(text, "```json"); at != -1 {
		text = text[at:]
	}
	start := strings.IndexAny(text, "[{")
	if start == -1 {
		return text
	}
	open, closing := text[start], byte('}')
	if open == '[' {
		closing = ']'
	}
	count := 0
	for i := start; i < len(text); i++ {
		count += bracketStep(text[i], open, closing)
		if count == 0 {
			return text[start : i+1]
		}
	}
	return text
}

func bracketStep(c, open, closing byte) int {
	switch c {
	case open:
		return 1
	case closing:
		return -1
	}
	return 0
}

// RagasParseJSONMarkdown is langchain-core's parse_json_markdown over
// parse_partial_json: a failed parse retries on the fenced content.
func RagasParseJSONMarkdown(text string) (any, error) {
	value, err := parseLangchainJSON(text)
	if err == nil {
		return value, nil
	}
	// langchain's _json_markdown_re.
	if match := regexp.MustCompile("(?s)```(json)?(.*)").FindStringSubmatch(text); match != nil {
		text = match[2]
	}
	return parseLangchainJSON(text)
}

func parseLangchainJSON(text string) (any, error) {
	return parsePartialJSON(strings.Trim(text, " \n\r\t`"))
}

// parsePartialJSON is langchain's parse_partial_json: unterminated strings,
// arrays and objects are closed, trailing characters dropped until it
// parses. A mismatched closer is None (nil, no error).
func parsePartialJSON(s string) (any, error) {
	if value, err := pyJSONLoads(s); err == nil {
		return value, nil
	}
	scan := &partialJSONScan{}
	for _, r := range s {
		if !scan.step(r) {
			return nil, nil
		}
	}
	chars, closers := scan.closed()
	for len(chars) > 0 {
		if value, err := pyJSONLoads(strings.Join(chars, "") + closers); err == nil {
			return value, nil
		}
		chars = chars[:len(chars)-1]
	}
	return pyJSONLoads(s)
}

// partialJSONScan is parse_partial_json's single pass over the characters.
type partialJSONScan struct {
	chars, stack      []string
	inString, escaped bool
}

// step takes one character; false on a closer that matches no opener.
func (p *partialJSONScan) step(r rune) bool {
	char := string(r)
	if p.inString {
		char = p.stepInString(r)
	} else {
		switch r {
		case '"':
			p.inString, p.escaped = true, false
		case '{':
			p.stack = append(p.stack, "}")
		case '[':
			p.stack = append(p.stack, "]")
		case '}', ']':
			if len(p.stack) == 0 || p.stack[len(p.stack)-1] != char {
				return false
			}
			p.stack = p.stack[:len(p.stack)-1]
		}
	}
	p.chars = append(p.chars, char)
	return true
}

func (p *partialJSONScan) stepInString(r rune) string {
	switch {
	case r == '"' && !p.escaped:
		p.inString = false
	case r == '\n' && !p.escaped:
		return `\n`
	case r == '\\':
		p.escaped = !p.escaped
	default:
		p.escaped = false
	}
	return string(r)
}

// closed is the characters with an open string closed, and the closers of
// the open arrays and objects, innermost first.
func (p *partialJSONScan) closed() ([]string, string) {
	chars := p.chars
	if p.inString {
		if p.escaped {
			chars = chars[:len(chars)-1]
		}
		chars = append(chars, `"`)
	}
	var closers strings.Builder
	for i := len(p.stack) - 1; i >= 0; i-- {
		closers.WriteString(p.stack[i])
	}
	return chars, closers.String()
}

// pyJSONLoads is Python's json.loads(strict=False): raw control characters
// are allowed inside strings; numbers stay json.Number for lax validation.
// ponytail: NaN and Infinity literals are refused where Python takes them.
func pyJSONLoads(s string) (any, error) {
	escaped := escapeControlInStrings(s)
	if !json.Valid(escaped) {
		return nil, errors.New("invalid json")
	}
	decoder := json.NewDecoder(bytes.NewReader(escaped))
	decoder.UseNumber()
	var value any
	err := decoder.Decode(&value)
	return value, err
}

func escapeControlInStrings(s string) []byte {
	out := make([]byte, 0, len(s))
	inString, escaped := false, false
	for i := 0; i < len(s); i++ {
		c := s[i]
		if inString {
			switch {
			case escaped:
				escaped = false
			case c == '\\':
				escaped = true
			case c == '"':
				inString = false
			case c < 0x20:
				out = fmt.Appendf(out, `\u%04x`, c)
				continue
			}
		} else if c == '"' {
			inString = true
		}
		out = append(out, c)
	}
	return out
}
