// Package linkcheck resolves the links in a markdown document: repository
// paths against the working tree, URLs against the network.
//
// Spec: specs/ci/readme-link-check.feature
package linkcheck

import (
	"net/http"
	"regexp"
	"strings"
)

// Link is one link occurrence in a document.
type Link struct {
	Target string
	Line   int
}

// Kind says where a link's target has to be resolved, if anywhere.
type Kind int

const (
	// Ignored covers anchors, mail addresses, localhost and any other scheme:
	// targets that no checker can resolve and none should try to.
	Ignored Kind = iota
	// RepoPath is a path in this repository. GitHub rewrites a root-relative
	// README link onto the repository's own blob path, so "/LICENSE.md" is a
	// repository path and never a URL.
	RepoPath
	// URL is an absolute http(s) target.
	URL
)

// Verdict is what a check concluded about a link.
type Verdict int

const (
	// OK means the target resolved.
	OK Verdict = iota
	// Dead means the target is gone. Only this verdict fails a run.
	Dead
	// Unverified means the answer says nothing about the target: a bot block,
	// a rate limit, a timeout. Reported, never gating — a check that fails on
	// npmjs.com answering 403 to a datacenter address gets ignored or removed.
	Unverified
)

var (
	markdownLink = regexp.MustCompile(`\[[^\]]*\]\(\s*<?([^)\s>]+)`)
	// Case-insensitive and either quote style: HREF= and href='...' are valid
	// HTML, and a badge written that way would otherwise go unchecked while
	// the run still printed a tick.
	htmlAttr = regexp.MustCompile(`(?i)(?:href|src)\s*=\s*(?:"([^"]+)"|'([^']+)')`)
)

// Extract returns every link in the document, line by line. The README's
// badges and hero image are raw HTML rather than markdown, so href and src
// attributes count as links too.
//
// Fenced code blocks are skipped: a link inside a ```bash sample is
// illustration, and checking it turns a documentation example into a red
// build.
func Extract(document string) []Link {
	var links []Link
	inFence := false

	for index, line := range strings.Split(document, "\n") {
		if isFenceDelimiter(line) {
			inFence = !inFence
			continue
		}
		if inFence {
			continue
		}

		links = append(links, linksInLine(line, index+1)...)
	}
	return links
}

// linksInLine returns a line's links, markdown first then HTML — pattern
// order, not the order they sit in the text.
func linksInLine(line string, number int) []Link {
	var links []Link
	for _, pattern := range []*regexp.Regexp{markdownLink, htmlAttr} {
		for _, match := range pattern.FindAllStringSubmatch(line, -1) {
			if target := firstCapture(match); target != "" {
				links = append(links, Link{Target: target, Line: number})
			}
		}
	}
	return links
}

// firstCapture returns the first non-empty capture group, since the HTML
// pattern has one group per quote style and only one of them can match.
func firstCapture(match []string) string {
	for _, group := range match[1:] {
		if trimmed := strings.TrimSpace(group); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func isFenceDelimiter(line string) bool {
	trimmed := strings.TrimSpace(line)
	return strings.HasPrefix(trimmed, "```") || strings.HasPrefix(trimmed, "~~~")
}

// Classify says how a target should be resolved.
func Classify(target string) Kind {
	lower := strings.ToLower(target)
	switch {
	case target == "", strings.HasPrefix(target, "#"):
		return Ignored
	case strings.HasPrefix(lower, "http://localhost"), strings.HasPrefix(lower, "https://localhost"),
		strings.HasPrefix(lower, "http://127.0.0.1"), strings.HasPrefix(lower, "https://127.0.0.1"):
		return Ignored
	case strings.HasPrefix(lower, "http://"), strings.HasPrefix(lower, "https://"):
		return URL
	case strings.Contains(target, ":"):
		// mailto:, tel:, and any other scheme we have no business fetching.
		// A bare path never contains a colon before its first slash.
		if scheme, _, found := strings.Cut(target, ":"); found && !strings.Contains(scheme, "/") {
			return Ignored
		}
		return RepoPath
	default:
		return RepoPath
	}
}

// VerdictFor grades one answer. A transport error is never fatal: it says the
// network was unhappy, not that the page is gone.
func VerdictFor(status int, err error) Verdict {
	if err != nil {
		return Unverified
	}
	switch {
	case status == http.StatusNotFound, status == http.StatusGone:
		return Dead
	case status >= 200 && status < 400:
		return OK
	default:
		return Unverified
	}
}
