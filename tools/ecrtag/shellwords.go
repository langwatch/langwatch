package ecrtag

import (
	"strings"
)

// shellWords splits a command into words, honoring quotes. `&&`, `||`, `;`
// and `|` come out as words of their own.
func shellWords(cmd string) []string {
	var s shellScanner
	for i := 0; i < len(cmd); i++ {
		i = s.scan(cmd, i)
	}
	s.flush()

	return s.words
}

// shellScanner holds the words of a command split so far, and the word being
// read.
type shellScanner struct {
	words  []string
	word   strings.Builder
	inWord bool
}

// flush ends the word being read.
func (s *shellScanner) flush() {
	if s.inWord {
		s.words = append(s.words, s.word.String())
		s.word.Reset()
		s.inWord = false
	}
}

// operator ends the word being read and adds a shell operator as a word.
func (s *shellScanner) operator(op string) {
	s.flush()
	s.words = append(s.words, op)
}

// scan reads the character at i, and returns the index of the last character
// it used.
func (s *shellScanner) scan(cmd string, i int) int {
	c := cmd[i]
	switch {
	case c == '\'':
		return s.singleQuoted(cmd, i)
	case c == '"':
		return s.doubleQuoted(cmd, i)
	case c == ' ' || c == '\t':
		s.flush()
	case c == ';':
		s.operator(";")
	case (c == '&' || c == '|') && i+1 < len(cmd) && cmd[i+1] == c:
		s.operator(string([]byte{c, c}))

		return i + 1
	case c == '|':
		s.operator("|")
	default:
		s.word.WriteByte(c)
		s.inWord = true
	}

	return i
}

// singleQuoted reads the quote at i and the text after it, up to the closing
// quote, and returns the index of the closing quote.
func (s *shellScanner) singleQuoted(cmd string, i int) int {
	end := strings.IndexByte(cmd[i+1:], '\'')
	if end < 0 {
		end = len(cmd) - i - 1
	}
	s.word.WriteString(cmd[i+1 : i+1+end])
	s.inWord = true

	return i + end + 1
}

// doubleQuoted reads the quote at i and the text after it, up to the closing
// quote, where a backslash escapes the next character. It returns the index
// of the closing quote.
func (s *shellScanner) doubleQuoted(cmd string, i int) int {
	for i++; i < len(cmd) && cmd[i] != '"'; i++ {
		if cmd[i] == '\\' && i+1 < len(cmd) {
			i++
		}
		s.word.WriteByte(cmd[i])
	}
	s.inWord = true

	return i
}
