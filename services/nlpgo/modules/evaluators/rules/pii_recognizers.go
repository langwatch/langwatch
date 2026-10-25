package rules

import (
	"context"
	"math"
	"slices"
	"sort"
	"time"

	"github.com/dlclark/regexp2"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
)

// piiRegexTimeout bounds one pattern's scan; Presidio skips a pattern that
// times out, and so does this.
const piiRegexTimeout = 10 * time.Second

// piiRegexOptions are Presidio's global_regex_flags: DOTALL, MULTILINE and
// IGNORECASE. regexp2 backtracks and supports lookarounds, as Python's does.
const piiRegexOptions = regexp2.IgnoreCase | regexp2.Multiline | regexp2.Singleline

// piiRecognizerSpec is one Presidio recognizer as transcribed in pii_table.go.
type piiRecognizerSpec struct {
	Name     string
	Entity   contract.EntityType
	Context  []string
	Patterns []piiPatternSpec
}

// piiPatternSpec is one Presidio Pattern.
type piiPatternSpec struct {
	Name  string
	Score float64
	Regex string
}

// PIIMatch is a finding and the recognizer that made it.
type PIIMatch struct {
	contract.PIIFinding
	Recognizer string
}

type piiPattern struct {
	score float64
	re    *regexp2.Regexp
}

type piiRecognizer struct {
	name     string
	entity   contract.EntityType
	context  []string
	patterns []piiPattern
}

// PIIPatterns is Presidio's English pattern analyzer: its recognizers
// compiled once, safe for concurrent use.
type PIIPatterns struct {
	recognizers []piiRecognizer
	stopWords   map[string]bool
	lemmas      map[string]string
	phone       *phoneFinder
	iban        map[string]*regexp2.Regexp
}

// NewPIIPatterns compiles the recognizers. It panics only on a table typo.
func NewPIIPatterns() *PIIPatterns {
	p := &PIIPatterns{stopWords: spacyStopWords(), lemmas: piiLemmas(), phone: newPhoneFinder(), iban: map[string]*regexp2.Regexp{}}
	for _, spec := range piiRecognizerTable() {
		r := piiRecognizer{name: spec.Name, entity: spec.Entity, context: spec.Context}
		for _, pattern := range spec.Patterns {
			re := regexp2.MustCompile(pattern.Regex, piiRegexOptions)
			re.MatchTimeout = piiRegexTimeout
			r.patterns = append(r.patterns, piiPattern{score: pattern.Score, re: re})
		}
		p.recognizers = append(p.recognizers, r)
	}
	for country, format := range ibanCountryFormats() {
		// Presidio's exact_match is off: re.match anchors the start only.
		re := regexp2.MustCompile(`\A`+format, regexp2.Multiline|regexp2.Singleline)
		re.MatchTimeout = piiRegexTimeout
		p.iban[country] = re
	}
	return p
}

// Covers are the entities the patterns can find.
func (p *PIIPatterns) Covers() []contract.EntityType {
	covers := make([]contract.EntityType, len(p.recognizers))
	for i, r := range p.recognizers {
		covers[i] = r.entity
	}
	return covers
}

// Analyze is AnalyzerEngine.analyze over the pattern recognizers: each
// recognizer's findings, context enhancement, then remove_duplicates. It
// answers ctx's error when ctx ends between recognizers.
func (p *PIIPatterns) Analyze(ctx context.Context, text string, entities []contract.EntityType) ([]PIIMatch, error) {
	runes := []rune(text)
	var results []PIIMatch
	for _, r := range p.recognizers {
		if !slices.Contains(entities, r.entity) {
			continue
		}
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		var found []PIIMatch
		if r.entity == "PHONE_NUMBER" {
			found = p.phone.find(runes, r.name)
		} else {
			found = p.analyzePatterns(runes, r)
		}
		results = append(results, removeDuplicates(found)...)
	}
	if len(results) == 0 {
		return nil, nil
	}
	return removeDuplicates(p.enhanceWithContext(runes, results)), nil
}

// analyzePatterns is PatternRecognizer.__analyze_patterns (IbanRecognizer's
// override for IBAN_CODE).
func (p *PIIPatterns) analyzePatterns(runes []rune, r piiRecognizer) []PIIMatch {
	var results []PIIMatch
	for _, pattern := range r.patterns {
		m, err := pattern.re.FindRunesMatch(runes)
		for ; m != nil && err == nil; m, err = pattern.re.FindNextMatch(m) {
			if found, ok := p.matchResult(r, pattern.score, m); ok {
				results = append(results, found)
			}
		}
	}
	return results
}

// matchResult scores one regex match; ok is false when it is no finding.
func (p *PIIPatterns) matchResult(r piiRecognizer, score float64, m *regexp2.Match) (PIIMatch, bool) {
	if m.Length == 0 {
		return PIIMatch{}, false
	}
	if r.entity == "IBAN_CODE" {
		return p.ibanMatch(r, score, m)
	}
	score = p.patternScore(r.entity, m.String(), score)
	return r.match(m.Index, m.Index+m.Length, score), score > 0
}

// ibanMatch tries the whole match, then each shorter group end, keeping the
// first that validates, as IbanRecognizer does.
func (p *PIIPatterns) ibanMatch(r piiRecognizer, score float64, m *regexp2.Match) (PIIMatch, bool) {
	matched := m.Runes()
	for group := m.GroupCount() - 1; group >= 1; group-- {
		end := ibanGroupEnd(m, group)
		if end <= m.Index {
			continue
		}
		if result := p.ibanScore(string(matched[:end-m.Index]), score); result > 0 {
			return r.match(m.Index, end, result), true
		}
	}
	return PIIMatch{}, false
}

// ibanGroupEnd is where a group ends, or the whole match when it took part
// nowhere (Python's span of -1).
func ibanGroupEnd(m *regexp2.Match, group int) int {
	if g := m.GroupByNumber(group); g != nil && len(g.Captures) > 0 && g.Index+g.Length > 0 {
		return g.Index + g.Length
	}
	return m.Index + m.Length
}

func (p *PIIPatterns) ibanScore(text string, score float64) float64 {
	valid, decided := p.validateIBAN(text)
	switch {
	case !decided:
		return score
	case valid:
		return 1
	}
	return 0
}

func (r piiRecognizer) match(start, end int, score float64) PIIMatch {
	return PIIMatch{PIIFinding: contract.PIIFinding{EntityType: r.entity, Start: start, End: end, Score: score}, Recognizer: r.name}
}

// patternScore applies validate_result and invalidate_result to a match.
func (p *PIIPatterns) patternScore(entity contract.EntityType, matched string, score float64) float64 {
	valid, decided := validatePII(entity, matched)
	if decided {
		if !valid {
			return 0
		}
		score = 1
	}
	if invalidatePII(entity, matched) {
		return 0
	}
	return score
}

// removeDuplicates is EntityRecognizer.remove_duplicates: equal findings
// collapse, then a finding inside a higher-ranked one of its type is dropped.
func removeDuplicates(results []PIIMatch) []PIIMatch {
	seen := make(map[contract.PIIFinding]struct{}, len(results))
	unique := make([]PIIMatch, 0, len(results))
	for _, r := range results {
		if _, duplicate := seen[r.PIIFinding]; !duplicate {
			seen[r.PIIFinding] = struct{}{}
			unique = append(unique, r)
		}
	}
	sort.SliceStable(unique, func(i, j int) bool { return rankBefore(unique[i].PIIFinding, unique[j].PIIFinding) })
	spans := newKeptSpans(unique)
	var kept []PIIMatch
	for _, r := range unique {
		if r.Score == 0 || spans.contain(r.PIIFinding) {
			continue
		}
		spans.keep(r.PIIFinding)
		kept = append(kept, r)
	}
	return kept
}

// keptSpans answers "does a kept finding of this type contain this one" in
// O(log n): per type, a Fenwick tree of the largest kept end over starts.
type keptSpans map[contract.EntityType]*spanIndex

type spanIndex struct {
	starts []int // sorted, distinct
	maxEnd []int // 1-based Fenwick tree of prefix maxima
}

func newKeptSpans(findings []PIIMatch) keptSpans {
	spans := keptSpans{}
	for _, f := range findings {
		index := spans[f.EntityType]
		if index == nil {
			index = &spanIndex{}
			spans[f.EntityType] = index
		}
		index.starts = append(index.starts, f.Start)
	}
	for _, index := range spans {
		slices.Sort(index.starts)
		index.starts = slices.Compact(index.starts)
		index.maxEnd = make([]int, len(index.starts)+1)
		for i := range index.maxEnd {
			index.maxEnd[i] = math.MinInt
		}
	}
	return spans
}

// contain says a kept finding of f's type starts at or before f and ends at
// or after it.
func (s keptSpans) contain(f contract.PIIFinding) bool {
	index := s[f.EntityType]
	best := math.MinInt
	for i := sort.SearchInts(index.starts, f.Start+1); i > 0; i -= i & -i {
		best = max(best, index.maxEnd[i])
	}
	return best >= f.End
}

func (s keptSpans) keep(f contract.PIIFinding) {
	index := s[f.EntityType]
	for i := sort.SearchInts(index.starts, f.Start) + 1; i < len(index.maxEnd); i += i & -i {
		index.maxEnd[i] = max(index.maxEnd[i], f.End)
	}
}

// rankBefore is remove_duplicates' sort key (-score, start, -length). Ties
// Python leaves to set order are broken by entity type.
func rankBefore(a, b contract.PIIFinding) bool {
	if a.Score != b.Score {
		return a.Score > b.Score
	}
	if a.Start != b.Start {
		return a.Start < b.Start
	}
	if a.End-a.Start != b.End-b.Start {
		return a.End-a.Start > b.End-b.Start
	}
	return a.EntityType < b.EntityType
}
