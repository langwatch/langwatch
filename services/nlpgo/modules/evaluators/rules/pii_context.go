package rules

import (
	"sort"
	"strings"
	"unicode"
)

// Presidio's LemmaContextAwareEnhancer defaults.
const (
	contextSimilarityFactor = 0.35
	minScoreWithContext     = 0.4
	contextPrefixCount      = 5
	contextMaxScore         = 1.0
)

// piiToken is one spaCy-like token: its rune offset, text and lemma.
type piiToken struct {
	start int
	text  []rune
	lemma string
}

// enhanceWithContext raises each finding whose recognizer's context word
// appears in the lemmas around it (plan §9: a fixed lemma table stands in
// for spaCy's lemmatizer, and a rule tokenizer for its tokenizer).
func (p *PIIPatterns) enhanceWithContext(runes []rune, results []PIIMatch) []PIIMatch {
	tokens := tokenizer{runes: runes, lemmas: p.lemmas}.tokens()
	keyword := make([]bool, len(tokens))
	for i, t := range tokens {
		keyword[i] = p.isKeyword(t.lemma)
	}
	contexts := map[string][]string{}
	for _, r := range p.recognizers {
		contexts[r.name] = r.context
	}
	out := make([]PIIMatch, len(results))
	for i, result := range results {
		out[i] = result
		index := matchTokenIndex(tokens, result.Start)
		if index < 0 {
			continue
		}
		window := surroundingLemmas(tokens, keyword, index)
		if hasContextWord(window, contexts[result.Recognizer]) {
			score := result.Score + contextSimilarityFactor
			score = max(score, minScoreWithContext)
			out[i].Score = min(score, contextMaxScore)
		}
	}
	return out
}

// isKeyword is NlpArtifacts.set_keywords' filter: not a stop word, not all
// punctuation, not "be", and no ':' (Presidio splits those lemmas apart).
func (p *PIIPatterns) isKeyword(lemma string) bool {
	if p.stopWords[lemma] || lemma == "be" || strings.Contains(lemma, ":") {
		return false
	}
	for _, r := range lemma {
		if !unicode.IsPunct(r) {
			return true
		}
	}
	return false
}

// matchTokenIndex is _find_index_of_match_token: the first token ending
// after the finding's start. Tokens are non-empty and in text order, so
// their ends ascend and a binary search finds it.
func matchTokenIndex(tokens []piiToken, start int) int {
	i := sort.Search(len(tokens), func(i int) bool { return start < tokens[i].start+len(tokens[i].text) })
	if i == len(tokens) {
		return -1
	}
	return i
}

// surroundingLemmas are the keyword lemmas from the match token back until
// six are found, plus the first keyword at or after it (suffix count 0).
func surroundingLemmas(tokens []piiToken, keyword []bool, index int) []string {
	var words []string
	remaining := contextPrefixCount + 1
	for i := index; i >= 0 && remaining > 0; i-- {
		if keyword[i] {
			words = append(words, tokens[i].lemma)
			remaining--
		}
	}
	for i := index; i < len(tokens); i++ {
		if keyword[i] {
			words = append(words, tokens[i].lemma)
			break
		}
	}
	return words
}

// hasContextWord is substring matching, Presidio's default mode.
func hasContextWord(window, context []string) bool {
	for _, word := range context {
		lower := strings.ToLower(word)
		for _, lemma := range window {
			if strings.Contains(lemma, lower) {
				return true
			}
		}
	}
	return false
}

// tokenizer approximates spaCy's English tokenizer: whitespace other than a
// single space is a token, leading and trailing punctuation splits off, and
// hyphens between digits split. Emails and URLs stay whole.
type tokenizer struct {
	runes  []rune
	lemmas map[string]string
}

func (t tokenizer) tokens() []piiToken {
	var tokens []piiToken
	for i := 0; i < len(t.runes); {
		j := i
		space := unicode.IsSpace(t.runes[i])
		for j < len(t.runes) && unicode.IsSpace(t.runes[j]) == space {
			j++
		}
		switch {
		case space && (j-i != 1 || t.runes[i] != ' '):
			tokens = append(tokens, t.token(i, j))
		case !space:
			tokens = append(tokens, t.chunk(i, j)...)
		}
		i = j
	}
	return tokens
}

func (t tokenizer) token(start, end int) piiToken {
	text := t.runes[start:end]
	lower := strings.ToLower(string(text))
	if lemma, ok := t.lemmas[lower]; ok {
		return piiToken{start: start, text: text, lemma: lemma}
	}
	return piiToken{start: start, text: text, lemma: lower}
}

// chunk splits one whitespace-free chunk into prefix, infix and suffix tokens.
func (t tokenizer) chunk(start, end int) []piiToken {
	head, start := t.prefixes(start, end)
	tail, end := t.suffixes(start, end)
	word := string(t.runes[start:end])
	if strings.Contains(word, "@") || strings.Contains(word, "://") {
		return append(append(head, t.token(start, end)), tail...)
	}
	return append(append(head, t.infixes(start, end)...), tail...)
}

func (t tokenizer) prefixes(start, end int) ([]piiToken, int) {
	var head []piiToken
	for end-start > 1 && isPrefixRune(t.runes[start], t.runes[start+1]) {
		head = append(head, t.token(start, start+1))
		start++
	}
	return head, start
}

func (t tokenizer) suffixes(start, end int) ([]piiToken, int) {
	var tail []piiToken
	for end-start > 1 && isSuffixRune(t.runes[end-1]) {
		tail = append([]piiToken{t.token(end-1, end)}, tail...)
		end--
	}
	return tail, end
}

func (t tokenizer) infixes(start, end int) []piiToken {
	var tokens []piiToken
	from := start
	for k := start + 1; k < end-1; k++ {
		if !isInfix(t.runes[k-1], t.runes[k], t.runes[k+1]) {
			continue
		}
		if from < k {
			tokens = append(tokens, t.token(from, k))
		}
		tokens = append(tokens, t.token(k, k+1))
		from = k + 1
	}
	if from < end {
		tokens = append(tokens, t.token(from, end))
	}
	return tokens
}

func isPrefixRune(r, next rune) bool {
	if r == '+' {
		return !unicode.IsDigit(next)
	}
	return strings.ContainsRune(`([{"'“‘«$£€¥#<§%=—–*&`, r) || (unicode.IsPunct(r) && r != '-' && r != '.')
}

func isSuffixRune(r rune) bool {
	return strings.ContainsRune(`.,;:!?)]}"'”’»…%`, r)
}

// isInfix is spaCy's infixes that matter for numbers and words: an
// operator between digits, a hyphen before a letter, ':' '/' before a
// letter, and a comma between letters.
func isInfix(prev, r, next rune) bool {
	switch {
	case unicode.IsDigit(prev) && strings.ContainsRune("+-*^", r) && (unicode.IsDigit(next) || next == '-'):
		return true
	case (unicode.IsLetter(prev) || unicode.IsDigit(prev)) && strings.ContainsRune("-–—~:<>=/", r) && unicode.IsLetter(next):
		return true
	case unicode.IsLetter(prev) && r == ',' && unicode.IsLetter(next):
		return true
	}
	return false
}
