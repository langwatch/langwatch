package visualdiff

import (
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"unicode"
)

// Classification is the verdict on one row. It is the only vocabulary: the
// report, findings.jsonl and summary.txt all speak it.
type Classification string

// The finding classes fail the run.
const (
	// ClassMissingCandidate is a screen the base captured and the candidate never did.
	ClassMissingCandidate Classification = "missing-candidate"
	// ClassMissingBase is a screen the candidate captured and the base never did:
	// nothing was compared, so it is never read as a change.
	ClassMissingBase Classification = "missing-base"
	// ClassCaptureFailed is a screen whose own modules did not load on a side,
	// even taken again alone: the tool's failure, so it is never read as blank.
	ClassCaptureFailed Classification = "capture-failed"
	// ClassBrokenBoth is a route or flow step that fails on both refs.
	ClassBrokenBoth Classification = "broken-both"
	// ClassRegression is the candidate throwing, or failing a step, where the base does not.
	ClassRegression Classification = "regression"
	// ClassNotFound is the candidate showing its not-found page where the base renders the screen.
	ClassNotFound Classification = "not-found"
	// ClassBlank is a candidate page with no text at all.
	ClassBlank Classification = "blank"
	// ClassRedirect is the candidate ending on a different path than the base.
	ClassRedirect Classification = "redirect"
	// ClassAPIError is a 4xx, 5xx or failed request on /api/ or tRPC the base does not make.
	ClassAPIError Classification = "api-error"
	// ClassControls is a button, link, heading, tab or form control one side has and the other lacks.
	ClassControls Classification = "controls"
)

// The informational classes are reported and never fail the run.
const (
	// ClassIntendedRestore is the base having no such screen where the candidate renders one.
	ClassIntendedRestore Classification = "intended-restore"
	// ClassCopy is the same controls with different words.
	ClassCopy Classification = "copy"
	// ClassChanged is a real visual difference that none of the rules explain.
	ClassChanged Classification = "changed"
	// ClassNoise is a small difference with nothing wrong on either side.
	ClassNoise Classification = "noise"
	// ClassUncovered is a route one of the refs declares and visualdiff.yaml neither
	// renders nor excludes (coverage.go). It is a finding.
	ClassUncovered Classification = "uncovered"
)

var findingClasses = map[Classification]bool{
	ClassMissingCandidate: true, ClassMissingBase: true, ClassCaptureFailed: true, ClassBrokenBoth: true,
	ClassRegression: true, ClassNotFound: true, ClassBlank: true, ClassRedirect: true,
	ClassAPIError: true, ClassControls: true, ClassUncovered: true,
}

// IsFinding reports whether a class fails the run.
func (class Classification) IsFinding() bool { return findingClasses[class] }

// NoiseRatio is the diff ratio below which an error-free difference is noise.
const NoiseRatio = 0.02

// Row pairs one screen's two captures.
type Row struct {
	Edition   Edition        `json:"edition,omitempty"`
	Kind      string         `json:"kind"`
	Key       string         `json:"key"`
	Index     int            `json:"index"`
	Label     string         `json:"label"`
	Base      *Capture       `json:"base"`
	Candidate *Capture       `json:"candidate"`
	Ratio     float64        `json:"ratio"`
	Diffed    bool           `json:"diffed"`
	DiffFile  string         `json:"diffFile"`
	Class     Classification `json:"class"`
	Why       string         `json:"why"`
	Text      TextDiff       `json:"text"`
}

// Finding reports whether a row is something to look at.
func (row Row) Finding() bool { return row.Class.IsFinding() }

// NeedsPixels reports whether the verdict still waits on the pixel diff: every
// rule but the last two is decided from the captures alone.
func NeedsPixels(class Classification) bool {
	return class == ClassNoise || class == ClassChanged
}

// Classify is the one classifier. Failures run first, so a candidate that
// throws is never read as a restore; the text rules run before the pixel
// rules, so a missing button is never waved through as a small diff.
func Classify(row Row) (Classification, string) {
	base, candidate := row.Base, row.Candidate
	if candidate == nil {
		return ClassMissingCandidate, "no capture on the candidate"
	}
	if base == nil {
		return ClassMissingBase, "no capture on the base: nothing to compare against"
	}
	if why := moduleFailure(row); why != "" {
		return ClassCaptureFailed, why
	}
	if class, why := classifyFailure(row); class != "" {
		return class, why
	}
	if base.NotFound && !candidate.NotFound {
		return ClassIntendedRestore, "the base has no such screen and the candidate renders one"
	}
	text := CompareText(base.AriaSnapshot, candidate.AriaSnapshot)
	if text.ControlsChanged() {
		return ClassControls, "controls differ: " + text.Summary()
	}
	if text.CopyChanged {
		return ClassCopy, "same controls, different words"
	}
	if !row.Diffed {
		return ClassChanged, "no pixel diff: a screenshot is missing on one side"
	}
	if row.Ratio < NoiseRatio {
		return ClassNoise, fmt.Sprintf("differs by %.2f%% with no errors on either side", row.Ratio*100)
	}
	return ClassChanged, fmt.Sprintf("differs by %.2f%%", row.Ratio*100)
}

// classifyFailure is every rule that fails the run on the captures alone,
// or "" when none applies.
func classifyFailure(row Row) (Classification, string) {
	base, candidate := row.Base, row.Candidate
	switch {
	case candidate.Error != "" && base.Error != "":
		return ClassBrokenBoth, row.Kind + " broken on both: " + head(candidate.Error)
	case candidate.Error != "":
		return ClassRegression, "candidate failed where the base did not: " + head(candidate.Error)
	case base.Error != "":
		return ClassIntendedRestore, "the base failed where the candidate renders: " + head(base.Error)
	case candidate.NotFound && !base.NotFound:
		return ClassNotFound, "the candidate shows its not-found page where the base renders the screen"
	case candidate.Blank:
		return ClassBlank, blankWhy(base.Blank)
	}
	if newErrors := onlyIn(candidate.ConsoleErrors, base.ConsoleErrors); len(newErrors) > 0 {
		return ClassRegression, "candidate console error the base does not have: " + head(newErrors[0])
	}
	if basePath, candidatePath := finalPath(base.URL), finalPath(candidate.URL); basePath != candidatePath {
		if reason := expectedRedirect(basePath, candidatePath); reason != "" {
			return ClassIntendedRestore, reason
		}
		return ClassRedirect, fmt.Sprintf("ends on %s where the base ends on %s", candidatePath, basePath)
	}
	if hits := NewAPIFailures(base.FailedRequests, candidate.FailedRequests); len(hits) > 0 {
		return ClassAPIError, "candidate request the base does not fail: " + head(hits[0])
	}
	return "", ""
}

// moduleFailure says which side could not load its own modules, or "".
func moduleFailure(row Row) string {
	for _, side := range []struct {
		name    string
		capture *Capture
	}{{"candidate", row.Candidate}, {"base", row.Base}} {
		if failures := side.capture.ModuleFailures; len(failures) > 0 {
			return fmt.Sprintf("the %s's dev server did not serve its modules (%d failed): %s", side.name, len(failures), head(failures[0]))
		}
	}
	return ""
}

func blankWhy(baseBlank bool) string {
	if baseBlank {
		return "a blank page on both refs"
	}
	return "the candidate renders a blank page"
}

// expectedRedirects are the base's own redirects away from a screen the
// candidate serves: main sends /ops/* to /governance, where the branch renders
// the operator screens. They are restores, not the candidate's defect.
var expectedRedirects = []struct{ candidatePrefix, basePath string }{
	{candidatePrefix: "/ops", basePath: "/governance"},
}

// expectedRedirect is why a base redirect is expected, or "".
func expectedRedirect(basePath, candidatePath string) string {
	for _, expected := range expectedRedirects {
		if basePath == expected.basePath && (candidatePath == expected.candidatePrefix ||
			strings.HasPrefix(candidatePath, expected.candidatePrefix+"/")) {
			return fmt.Sprintf("the base redirects %s/* to %s; the candidate renders %s", expected.candidatePrefix, basePath, candidatePath)
		}
	}
	return ""
}

// finalPath is a capture's URL path with ids masked, so two refs that each
// created their own entity still end on the same path.
func finalPath(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil || raw == "" {
		return raw
	}
	segments := strings.Split(strings.TrimSuffix(parsed.Path, "/"), "/")
	for index, segment := range segments {
		if randomID(segment) {
			segments[index] = "<id>"
		}
	}
	return MaskVolatile(strings.Join(segments, "/"))
}

// randomID reports a path segment that is a generated id rather than a word:
// six or more id characters mixing case, or mixing letters and digits.
func randomID(segment string) bool {
	if !idSegment.MatchString(segment) {
		return false
	}
	upper := strings.IndexFunc(segment, unicode.IsUpper) >= 0
	lower := strings.IndexFunc(segment, unicode.IsLower) >= 0
	digit := strings.IndexFunc(segment, unicode.IsDigit) >= 0
	return (upper && lower) || (digit && (upper || lower))
}

var idSegment = regexp.MustCompile(`^[A-Za-z0-9_-]{6,}$`)

// NewAPIFailures are the candidate's failed /api/ requests (tRPC included)
// the base does not fail: any 4xx or 5xx and any transport failure but a
// navigation abort. Requests compare without their query and with ids masked.
func NewAPIFailures(base, candidate []string) []string {
	seen := map[string]bool{}
	for _, entry := range base {
		seen[requestSignature(entry)] = true
	}
	var hits []string
	for _, entry := range candidate {
		if !isAPIFailure(entry) || seen[requestSignature(entry)] {
			continue
		}
		hits = append(hits, entry)
	}
	return hits
}

func isAPIFailure(entry string) bool {
	return strings.Contains(entry, "/api/") && !strings.Contains(entry, "net::ERR_ABORTED")
}

// requestSignature is "<status> <method> <path>" of a recorded failure.
func requestSignature(entry string) string {
	fields := strings.Fields(entry)
	if len(fields) < 3 {
		return MaskVolatile(entry)
	}
	path, _, _ := strings.Cut(fields[2], "?")
	return fields[0] + " " + fields[1] + " " + MaskVolatile(path)
}

// onlyIn returns the entries present in candidate and absent from base,
// compared masked and on their first 80 characters, so a trailing id never
// reads as a new error.
func onlyIn(candidate, base []string) []string {
	seen := map[string]bool{}
	for _, entry := range base {
		seen[head(MaskVolatile(entry))] = true
	}
	var out []string
	for _, entry := range candidate {
		if !seen[head(MaskVolatile(entry))] {
			out = append(out, entry)
		}
	}
	return out
}

func head(value string) string {
	if len(value) > 80 {
		return value[:80]
	}
	return value
}
