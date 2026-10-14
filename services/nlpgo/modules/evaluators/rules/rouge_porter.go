package rules

import "strings"

// porterStem is nltk 3.10's PorterStemmer().stem in its default
// NLTK_EXTENSIONS mode, for lowercase ASCII words (rouge's tokens).
func porterStem(word string) string {
	if stem, ok := porterIrregular(word); ok {
		return stem
	}
	if len(word) <= 2 {
		return word
	}
	for _, step := range []func(string) string{
		porterStep1a, porterStep1b, porterStep1c, porterStep2,
		porterStep3, porterStep4, porterStep5a, porterStep5b,
	} {
		word = step(word)
	}
	return word
}

func porterIrregular(word string) (string, bool) {
	switch word {
	case "sky", "skies":
		return "sky", true
	case "dying":
		return "die", true
	case "lying":
		return "lie", true
	case "tying":
		return "tie", true
	case "news", "howe", "proceed", "exceed", "succeed", "inning", "outing", "canning":
		return word, true
	case "innings", "outings", "cannings":
		return strings.TrimSuffix(word, "s"), true
	}
	return "", false
}

func isVowel(c byte) bool {
	return c == 'a' || c == 'e' || c == 'i' || c == 'o' || c == 'u'
}

// isConsonant is _is_consonant: a y is a consonant unless an odd run of y's
// ending at i follows a consonant.
func isConsonant(word string, i int) bool {
	if isVowel(word[i]) {
		return false
	}
	if word[i] != 'y' {
		return true
	}
	negate := false
	for i > 0 && word[i] == 'y' {
		negate = !negate
		i--
	}
	return !isVowel(word[i]) != negate
}

// measure counts the "vc" pairs in the word's consonant/vowel sequence.
func measure(stem string) int {
	count := 0
	for i := 1; i < len(stem); i++ {
		if !isConsonant(stem, i-1) && isConsonant(stem, i) {
			count++
		}
	}
	return count
}

func positiveMeasure(stem string) bool { return measure(stem) > 0 }

func measureAboveOne(stem string) bool { return measure(stem) > 1 }

func containsVowel(stem string) bool {
	for i := range len(stem) {
		if !isConsonant(stem, i) {
			return true
		}
	}
	return false
}

func endsDoubleConsonant(word string) bool {
	n := len(word)
	return n >= 2 && word[n-1] == word[n-2] && isConsonant(word, n-1)
}

func endsCVC(word string) bool {
	n := len(word)
	if n == 2 {
		return !isConsonant(word, 0) && isConsonant(word, 1)
	}
	return n >= 3 && isConsonant(word, n-3) && !isConsonant(word, n-2) &&
		isConsonant(word, n-1) && !strings.ContainsRune("wxy", rune(word[n-1]))
}

// porterRule is one (suffix, replacement, condition) of _apply_rule_list; a
// nil condition always holds.
type porterRule struct {
	suffix, replacement string
	condition           func(stem string) bool
}

// applyRules is _apply_rule_list: the first rule whose suffix matches decides,
// replacing it when its condition holds on the stem, else keeping the word.
// The "*d" suffix matches a double consonant ending.
func applyRules(word string, rules []porterRule) string {
	for _, rule := range rules {
		var stem string
		switch {
		case rule.suffix == "*d" && endsDoubleConsonant(word):
			stem = word[:len(word)-2]
		case strings.HasSuffix(word, rule.suffix):
			stem = word[:len(word)-len(rule.suffix)]
		default:
			continue
		}
		if rule.condition == nil || rule.condition(stem) {
			return stem + rule.replacement
		}
		return word
	}
	return word
}

func porterStep1a(word string) string {
	if strings.HasSuffix(word, "ies") && len(word) == 4 {
		return word[:1] + "ie"
	}
	return applyRules(word, []porterRule{
		{"sses", "ss", nil},
		{"ies", "i", nil},
		{"ss", "ss", nil},
		{"s", "", nil},
	})
}

// porterStep1bEndings are step 1b's "ied" (an NLTK extension) and "eed"
// rules, which decide the step when they match.
func porterStep1bEndings(word string) (string, bool) {
	if stem, ok := strings.CutSuffix(word, "ied"); ok {
		if len(word) == 4 {
			return stem + "ie", true
		}
		return stem + "i", true
	}
	if stem, ok := strings.CutSuffix(word, "eed"); ok {
		if measure(stem) > 0 {
			return stem + "ee", true
		}
		return word, true
	}
	return "", false
}

func porterStep1b(word string) string {
	if stemmed, ok := porterStep1bEndings(word); ok {
		return stemmed
	}
	stem, ok := strings.CutSuffix(word, "ed")
	if !ok || !containsVowel(stem) {
		stem, ok = strings.CutSuffix(word, "ing")
		if !ok || !containsVowel(stem) {
			return word
		}
	}
	last := stem[len(stem)-1:]
	return applyRules(stem, []porterRule{
		{"at", "ate", nil},
		{"bl", "ble", nil},
		{"iz", "ize", nil},
		{"*d", last, func(string) bool { return !strings.ContainsAny(last, "lsz") }},
		{"", "e", func(s string) bool { return measure(s) == 1 && endsCVC(s) }},
	})
}

func porterStep1c(word string) string {
	return applyRules(word, []porterRule{
		{"y", "i", func(stem string) bool { return len(stem) > 1 && isConsonant(stem, len(stem)-1) }},
	})
}

func porterStep2(word string) string {
	if stem, ok := strings.CutSuffix(word, "alli"); ok && positiveMeasure(stem) {
		return porterStep2(stem + "al")
	}
	return applyRules(word, []porterRule{
		{"ational", "ate", positiveMeasure},
		{"tional", "tion", positiveMeasure},
		{"enci", "ence", positiveMeasure},
		{"anci", "ance", positiveMeasure},
		{"izer", "ize", positiveMeasure},
		{"bli", "ble", positiveMeasure},
		{"alli", "al", positiveMeasure},
		{"entli", "ent", positiveMeasure},
		{"eli", "e", positiveMeasure},
		{"ousli", "ous", positiveMeasure},
		{"ization", "ize", positiveMeasure},
		{"ation", "ate", positiveMeasure},
		{"ator", "ate", positiveMeasure},
		{"alism", "al", positiveMeasure},
		{"iveness", "ive", positiveMeasure},
		{"fulness", "ful", positiveMeasure},
		{"ousness", "ous", positiveMeasure},
		{"aliti", "al", positiveMeasure},
		{"iviti", "ive", positiveMeasure},
		{"biliti", "ble", positiveMeasure},
		{"fulli", "ful", positiveMeasure},
		{"logi", "log", func(string) bool { return positiveMeasure(word[:len(word)-3]) }},
	})
}

func porterStep3(word string) string {
	return applyRules(word, []porterRule{
		{"icate", "ic", positiveMeasure},
		{"ative", "", positiveMeasure},
		{"alize", "al", positiveMeasure},
		{"iciti", "ic", positiveMeasure},
		{"ical", "ic", positiveMeasure},
		{"ful", "", positiveMeasure},
		{"ness", "", positiveMeasure},
	})
}

func porterStep4(word string) string {
	return applyRules(word, []porterRule{
		{"al", "", measureAboveOne},
		{"ance", "", measureAboveOne},
		{"ence", "", measureAboveOne},
		{"er", "", measureAboveOne},
		{"ic", "", measureAboveOne},
		{"able", "", measureAboveOne},
		{"ible", "", measureAboveOne},
		{"ant", "", measureAboveOne},
		{"ement", "", measureAboveOne},
		{"ment", "", measureAboveOne},
		{"ent", "", measureAboveOne},
		{"ion", "", func(stem string) bool {
			return measureAboveOne(stem) && (strings.HasSuffix(stem, "s") || strings.HasSuffix(stem, "t"))
		}},
		{"ou", "", measureAboveOne},
		{"ism", "", measureAboveOne},
		{"ate", "", measureAboveOne},
		{"iti", "", measureAboveOne},
		{"ous", "", measureAboveOne},
		{"ive", "", measureAboveOne},
		{"ize", "", measureAboveOne},
	})
}

func porterStep5a(word string) string {
	stem, ok := strings.CutSuffix(word, "e")
	if !ok {
		return word
	}
	if m := measure(stem); m > 1 || (m == 1 && !endsCVC(stem)) {
		return stem
	}
	return word
}

func porterStep5b(word string) string {
	return applyRules(word, []porterRule{
		{"ll", "l", func(string) bool { return measure(word[:len(word)-1]) > 1 }},
	})
}
