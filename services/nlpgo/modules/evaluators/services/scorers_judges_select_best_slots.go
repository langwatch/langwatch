package services

import (
	"strings"
	"unicode"
)

// This file is select_best_compare.py's _translate_slot_references: the
// judge's reasoning names slots ("Candidate B"), and is rewritten to name the
// candidates' ids. A label is only rewritten where it cannot be ordinary
// English ("A concise answer" keeps its article).

const (
	slotClosingAfter = ",.;:!?)]}\n\r"
	slotUnboundAfter = slotClosingAfter + " \t'’\"'”’`"
	slotOpeningQuote = "\"'“‘`"
	slotClosingQuote = "\"'”’`"
)

// slotMatch is one label in the text: begin is where the optional noun
// starts, slotStart where the label itself does, end where it stops.
type slotMatch struct {
	begin, slotStart, end int
}

func translateSlotReferences(reasoning string, slots map[string]selectBestCandidate) string {
	text := []rune(reasoning)
	var out strings.Builder
	for pos := 0; pos < len(text); {
		match, ok := slotMatchAt(text, pos)
		if !ok {
			out.WriteRune(text[pos])
			pos++
			continue
		}
		out.WriteString(match.replacement(text, slots))
		pos = match.end
	}
	return out.String()
}

func (m slotMatch) replacement(text []rune, slots map[string]selectBestCandidate) string {
	candidate, known := slots[strings.ToUpper(string(text[m.slotStart:m.end]))]
	if !known || !readsAsSlotReference(text, m) {
		return string(text[m.begin:m.end])
	}
	return string(text[m.begin:m.slotStart]) + candidate.ID
}

func isSlotWordRune(r rune) bool {
	return r == '_' || isASCIILetter(r) || (r >= '0' && r <= '9')
}

func isASCIILetter(r rune) bool {
	return (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z')
}

// slotMatchAt is _SLOT_REFERENCE_RE at pos: a label of one or two letters that
// is a word of its own, optionally after "candidate", "slot" or "option".
func slotMatchAt(text []rune, pos int) (slotMatch, bool) {
	if pos > 0 && isSlotWordRune(text[pos-1]) {
		return slotMatch{}, false
	}
	if slotStart, ok := slotNounEnd(text, pos); ok {
		if end, ok := slotLabelEnd(text, slotStart); ok {
			return slotMatch{begin: pos, slotStart: slotStart, end: end}, true
		}
	}
	if end, ok := slotLabelEnd(text, pos); ok {
		return slotMatch{begin: pos, slotStart: pos, end: end}, true
	}
	return slotMatch{}, false
}

// slotNounEnd is where the label starts after a noun and its gap, if one is there.
func slotNounEnd(text []rune, pos int) (int, bool) {
	for _, noun := range []string{"candidates", "candidate", "slots", "slot", "options", "option"} {
		if !hasPrefixFold(text[pos:], noun) {
			continue
		}
		gapEnd := pos + len(noun)
		for gapEnd < len(text) && (text[gapEnd] == ' ' || text[gapEnd] == '\t') {
			gapEnd++
		}
		if gapEnd > pos+len(noun) {
			return gapEnd, true
		}
	}
	return 0, false
}

func hasPrefixFold(text []rune, word string) bool {
	if len(text) < len(word) {
		return false
	}
	for i, letter := range word {
		if unicode.ToLower(text[i]) != letter {
			return false
		}
	}
	return true
}

// slotLabelEnd is the end of a one or two letter label at start that no word
// character follows.
func slotLabelEnd(text []rune, start int) (int, bool) {
	end := start
	for end < len(text) && end-start < 2 && isASCIILetter(text[end]) {
		end++
	}
	if end == start || (end < len(text) && isSlotWordRune(text[end])) {
		return 0, false
	}
	return end, true
}

// readsAsSlotReference is _reads_as_slot_reference.
func readsAsSlotReference(text []rune, match slotMatch) bool {
	token := string(text[match.slotStart:match.end])
	wordLike := isWordLikeSlotLabel(strings.ToUpper(token))
	upper := token == strings.ToUpper(token)
	switch {
	case match.slotStart > match.begin:
		if !wordLike || upper {
			return true
		}
	case !upper:
		return false
	case isQuotedSlot(text, match):
		return false
	case bindsToWhatFollows(text, match.end):
		return false
	case !wordLike:
		return true
	}
	return englishReadingIsRuledOut(text, match)
}

func isQuotedSlot(text []rune, match slotMatch) bool {
	if match.slotStart == 0 || match.end >= len(text) {
		return false
	}
	return strings.ContainsRune(slotOpeningQuote, text[match.slotStart-1]) && strings.ContainsRune(slotClosingQuote, text[match.end])
}

// bindsToWhatFollows is true when the next character glues the label into a
// longer name, as the plus signs do in "C++".
func bindsToWhatFollows(text []rune, end int) bool {
	return end < len(text) && !strings.ContainsRune(slotUnboundAfter, text[end])
}

func englishReadingIsRuledOut(text []rune, match slotMatch) bool {
	after := text[match.end:]
	if len(after) == 0 || strings.ContainsRune(slotClosingAfter, after[0]) {
		return true
	}
	if len(after) >= 2 && (after[0] == '\'' || after[0] == '’') && unicode.ToLower(after[1]) == 's' {
		return true
	}
	next := nextSlotWord(after)
	if isNonArticleFollower(normalizeApostrophe(next)) {
		return true
	}
	if isComparativePreceder(normalizeApostrophe(previousSlotWord(text[:match.slotStart]))) {
		return !startsUpper(next)
	}
	return false
}

func isSlotWordLetter(r rune) bool {
	return isASCIILetter(r) || r == '\'' || r == '’'
}

// nextSlotWord is _next_word: the letters that start the text after blanks.
func nextSlotWord(after []rune) string {
	start := 0
	for start < len(after) && (after[start] == ' ' || after[start] == '\t') {
		start++
	}
	end := start
	for end < len(after) && isSlotWordLetter(after[end]) {
		end++
	}
	return string(after[start:end])
}

// previousSlotWord is _previous_word: the last run of letters, when nothing
// but non-letters follows it.
func previousSlotWord(before []rune) string {
	lastLetter := len(before) - 1
	for lastLetter >= 0 && !isASCIILetter(before[lastLetter]) {
		lastLetter--
	}
	if lastLetter < 0 {
		return ""
	}
	start, end := lastLetter, lastLetter+1
	for start > 0 && isSlotWordLetter(before[start-1]) {
		start--
	}
	for end < len(before) && isSlotWordLetter(before[end]) {
		end++
	}
	return string(before[start:end])
}

func normalizeApostrophe(word string) string {
	return strings.ToLower(strings.ReplaceAll(word, "’", "'"))
}

func startsUpper(word string) bool {
	return word != "" && word[0] >= 'A' && word[0] <= 'Z'
}

// isWordLikeSlotLabel is _WORD_LIKE_SLOT_LABELS: labels that are also English words.
func isWordLikeSlotLabel(label string) bool {
	switch label {
	case "A", "AI", "AM", "AN", "AS", "AT", "BE", "BY", "DO", "GO", "HE", "I", "ID", "IF", "IN", "IS", "IT", "ME", "MY", "NO", "OF", "OK", "ON", "OR", "SO", "TO", "UP", "US", "WE":
		return true
	}
	return false
}

// isComparativePreceder is _COMPARATIVE_PRECEDERS: what follows one is a candidate.
func isComparativePreceder(word string) bool {
	switch word {
	case "against", "alongside", "beats", "chose", "outperforms", "over", "picked", "prefers", "than", "to", "unlike", "versus", "vs", "with":
		return true
	}
	return false
}

// isNonArticleFollower is _NON_ARTICLE_FOLLOWERS: words that can follow a
// label but never the article "a" or the pronoun "I".
func isNonArticleFollower(word string) bool {
	switch word {
	case "is", "isn't", "was", "wasn't", "are", "aren't", "were", "weren't", "has", "hasn't", "have", "haven't", "had", "hadn't", "does", "doesn't", "do", "don't", "did", "didn't", "cannot", "can't", "won't", "would", "wouldn't", "could", "couldn't", "should", "shouldn't",
		"and", "or", "but", "nor", "however", "therefore", "then", "though", "although",
		"again", "also", "instead", "only",
		"adds", "addresses", "aligns", "answers", "appears", "beats", "captures", "cites", "comes", "contains", "covers", "delivers", "describes", "discusses", "drops", "elaborates", "explains", "fails", "follows", "gets", "gives", "handles", "hedges", "ignores", "includes", "lacks", "lists", "loses", "matches", "mentions", "misses", "names", "notes", "offers", "omits", "presents", "provides", "quotes", "ranks", "reads", "remains", "repeats", "restates", "says", "scores", "seems", "skips", "stays", "sticks", "summarizes", "ties", "tracks", "uses", "wanders", "wins":
		return true
	}
	return false
}
