package rules

import (
	"unicode"

	"github.com/dlclark/regexp2"
	"github.com/nyaruka/phonenumbers"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
)

// phoneScore is PhoneRecognizer.SCORE.
const phoneScore = 0.4

// phoneRegions are PhoneRecognizer.DEFAULT_SUPPORTED_REGIONS, in order.
func phoneRegions() []string { return []string{"US", "GB", "DE", "FR", "IL", "IN", "CA", "BR"} }

// The pieces of python-phonenumbers' PhoneNumberMatcher this finder keeps.
const (
	phonePunctuation = `[-x\x{2010}-\x{2015}\x{2212}\x{30FC}\x{FF0D}-\x{FF0F} \x{00A0}\x{00AD}\x{200B}\x{2060}\x{3000}()\x{FF08}\x{FF09}\x{FF3B}\x{FF3D}.\[\]/~\x{2053}\x{223C}\x{FF5E}]{0,4}`
	phoneLeadClass   = `[(\[\x{FF08}\x{FF3B}+\x{FF0B}]`
	phoneCandidate   = `(?:` + phoneLeadClass + phonePunctuation + `){0,2}\d{1,20}(?:` + phonePunctuation + `\d{1,20}){0,20}`
)

// phoneFinder is the smallest stand-in for PhoneNumberMatcher at leniency
// VALID: candidate spans, the date, time and letter-neighbor rejections, the
// inner-match retries, then libphonenumber's validity checks. It does not
// read extensions ("ext. 12").
type phoneFinder struct {
	candidate *regexp2.Regexp
	dates     *regexp2.Regexp
	timeStamp *regexp2.Regexp
	timeAfter *regexp2.Regexp
	lead      *regexp2.Regexp
	inner     []*regexp2.Regexp
	unwanted  *regexp2.Regexp
	second    *regexp2.Regexp
	brackets  *regexp2.Regexp
	pubPages  *regexp2.Regexp
}

func newPhoneFinder() *phoneFinder {
	compile := func(expr string) *regexp2.Regexp {
		re := regexp2.MustCompile(expr, regexp2.IgnoreCase)
		re.MatchTimeout = piiRegexTimeout
		return re
	}
	return &phoneFinder{
		candidate: compile(phoneCandidate),
		dates:     compile(`(?:(?:[0-3]?\d/[01]?\d)|(?:[01]?\d/[0-3]?\d))/(?:[12]\d)?\d{2}`),
		timeStamp: compile(`[12]\d{3}[-/]?[01]\d[-/]?[0-3]\d +[0-2]\d$`),
		timeAfter: compile(`\A:[0-5]\d`),
		lead:      compile(`\A` + phoneLeadClass),
		inner: []*regexp2.Regexp{
			compile(`/+(.*)`),
			compile(`(\([^(]*)`),
			compile(`(?:\p{Z}-|-\p{Z})\p{Z}*(.+)`),
			compile(`[\x{2012}-\x{2015}\x{FF0D}]\p{Z}*(.+)`),
			compile(`\.+\p{Z}*([^.]+)`),
			compile(`\p{Z}+(\P{Z}+)`),
		},
		pubPages: compile(`\d{1,5}-+\d{1,5}\s{0,4}\(\d{1,4}`),
		unwanted: compile(`[^\p{N}\p{L}#]+$`),
		second:   compile(`[\\/] *x`),
		brackets: compile(`\A(?:[(\[\x{FF08}\x{FF3B}])?(?:[^(\[\x{FF08}\x{FF3B})\]\x{FF09}\x{FF3D}]+[)\]\x{FF09}\x{FF3D}])?[^(\[\x{FF08}\x{FF3B})\]\x{FF09}\x{FF3D}]+(?:[(\[\x{FF08}\x{FF3B}][^(\[\x{FF08}\x{FF3B})\]\x{FF09}\x{FF3D}]+[)\]\x{FF09}\x{FF3D}]){0,3}[^(\[\x{FF08}\x{FF3B})\]\x{FF09}\x{FF3D}]*\z`),
	}
}

// find is PhoneRecognizer.analyze: every region's matches at score 0.4.
func (f *phoneFinder) find(runes []rune, recognizer string) []PIIMatch {
	var results []PIIMatch
	for _, region := range phoneRegions() {
		for _, span := range (phoneSearch{f: f, runes: runes, region: region}).spans() {
			results = append(results, PIIMatch{
				PIIFinding: contract.PIIFinding{EntityType: "PHONE_NUMBER", Start: span[0], End: span[1], Score: phoneScore},
				Recognizer: recognizer,
			})
		}
	}
	return results
}

// phoneSearch is one region's PhoneNumberMatcher pass over the text.
type phoneSearch struct {
	f      *phoneFinder
	runes  []rune
	region string
}

func (s phoneSearch) spans() [][2]int {
	var spans [][2]int
	for index := 0; index < len(s.runes); {
		m, err := s.f.candidate.FindRunesMatchStartingAt(s.runes, index)
		if err != nil || m == nil {
			break
		}
		candidate := s.f.trimAfterFirst(s.f.second, s.runes[m.Index:m.Index+m.Length])
		span, ok := s.extract(candidate, m.Index)
		if ok {
			spans = append(spans, span)
			index = span[1]
		} else {
			index = m.Index + max(len(candidate), 1)
		}
	}
	return spans
}

// extract is _extract_match: the whole candidate, else an inner match.
func (s phoneSearch) extract(candidate []rune, offset int) ([2]int, bool) {
	if s.isDateOrTime(candidate, offset) {
		return [2]int{}, false
	}
	if s.verify(candidate, offset) {
		return [2]int{offset, offset + len(candidate)}, true
	}
	for _, inner := range s.f.inner {
		if span, ok := s.innerMatch(inner, candidate, offset); ok {
			return span, true
		}
	}
	return [2]int{}, false
}

func (s phoneSearch) isDateOrTime(candidate []rune, offset int) bool {
	if found(s.f.dates, candidate) {
		return true
	}
	return found(s.f.timeStamp, candidate) && found(s.f.timeAfter, s.runes[offset+len(candidate):])
}

// innerMatch is one _extract_inner_match pattern: the text before its first
// match, then each match's group.
func (s phoneSearch) innerMatch(inner *regexp2.Regexp, candidate []rune, offset int) ([2]int, bool) {
	m, err := inner.FindRunesMatch(candidate)
	if err != nil || m == nil {
		return [2]int{}, false
	}
	if head := s.f.trimAfterFirst(s.f.unwanted, candidate[:m.Index]); s.verify(head, offset) {
		return [2]int{offset, offset + len(head)}, true
	}
	for ; m != nil && err == nil; m, err = inner.FindRunesMatchStartingAt(candidate, m.Index+1) {
		g := m.GroupByNumber(1)
		group := s.f.trimAfterFirst(s.f.unwanted, candidate[g.Index:g.Index+g.Length])
		if s.verify(group, offset+g.Index) {
			return [2]int{offset + g.Index, offset + g.Index + len(group)}, true
		}
	}
	return [2]int{}, false
}

// verify is _parse_and_verify at leniency VALID.
func (s phoneSearch) verify(candidate []rune, offset int) bool {
	if len(candidate) == 0 || !found(s.f.brackets, candidate) || found(s.f.pubPages, candidate) {
		return false
	}
	return !s.badNeighbors(candidate, offset) && validPhoneNumber(string(candidate), s.region)
}

// badNeighbors is a Latin letter or currency symbol just before (unless the
// candidate opens with a lead character) or just after the candidate.
func (s phoneSearch) badNeighbors(candidate []rune, offset int) bool {
	if offset > 0 && !found(s.f.lead, candidate) && invalidPhoneNeighbor(s.runes[offset-1]) {
		return true
	}
	next := offset + len(candidate)
	return next < len(s.runes) && invalidPhoneNeighbor(s.runes[next])
}

func validPhoneNumber(text, region string) bool {
	number, err := phonenumbers.ParseAndKeepRawInput(text, region)
	return err == nil && phonenumbers.IsValidNumber(number) &&
		phonenumbers.ContainsOnlyValidXChars(number, text) && phonenumbers.IsNationalPrefixPresentIfRequired(number)
}

// trimAfterFirst cuts the candidate where pattern first matches.
func (f *phoneFinder) trimAfterFirst(pattern *regexp2.Regexp, candidate []rune) []rune {
	m, err := pattern.FindRunesMatch(candidate)
	if err != nil || m == nil {
		return candidate
	}
	return candidate[:m.Index]
}

func found(pattern *regexp2.Regexp, text []rune) bool {
	m, err := pattern.FindRunesMatch(text)
	return err == nil && m != nil
}

// invalidPhoneNeighbor is a Latin letter, '%' or a currency symbol.
func invalidPhoneNeighbor(r rune) bool {
	if r == '%' || unicode.Is(unicode.Sc, r) {
		return true
	}
	if unicode.Is(unicode.Mn, r) {
		return r >= 0x300 && r <= 0x36F
	}
	return unicode.IsLetter(r) && unicode.In(r, unicode.Latin)
}
