// Package operatornotes adds the pull requests a release ships that need an
// operator to act on upgrade, those carrying the operator-action label, to the
// release's notes.
//
// Spec: specs/ci/deployment-impact-report.feature
package operatornotes

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// Heading opens the section; a rewrite replaces everything under it up to the next heading.
const Heading = "### Operator action required"

// changelogLink is how release-please links a pull request in a changelog line.
var changelogLink = regexp.MustCompile(`\[#(\d+)\]\(https://github\.com/[^/)]+/[^/)]+/(?:issues|pull)/\d+\)`)

// sectionStart matches the heading only as a whole line, never inside a changelog entry.
var sectionStart = regexp.MustCompile(`(?m)^` + regexp.QuoteMeta(Heading) + `$`)

// PullRequest is one pull request carrying the label the release ships.
type PullRequest struct {
	Number int    `json:"number"`
	Title  string `json:"title"`
	URL    string `json:"html_url"`
}

// Linked lists the pull request numbers the release notes link, first mention first.
func Linked(notes string) []int {
	seen := map[int]bool{}
	var numbers []int
	for _, match := range changelogLink.FindAllStringSubmatch(notes, -1) {
		number, err := strconv.Atoi(match[1])
		if err != nil || seen[number] {
			continue
		}
		seen[number] = true
		numbers = append(numbers, number)
	}
	return numbers
}

// Shipped keeps the pull request carrying the labels the notes link, in the notes' order.
func Shipped(notes string, marked []PullRequest) []PullRequest {
	byNumber := map[int]PullRequest{}
	for _, pr := range marked {
		byNumber[pr.Number] = pr
	}
	var shipped []PullRequest
	for _, number := range Linked(notes) {
		if pr, ok := byNumber[number]; ok {
			shipped = append(shipped, pr)
		}
	}
	return shipped
}

// WithSection returns the notes with the section listing prs, replacing any earlier one.
func WithSection(notes string, prs []PullRequest) string {
	notes = strings.TrimRight(withoutSection(notes), "\n")
	if len(prs) == 0 {
		return notes + "\n"
	}
	var b strings.Builder
	b.WriteString(notes)
	b.WriteString("\n\n" + Heading + "\n\n")
	b.WriteString("These changes need an operator to act on upgrade; each pull request's impact map says what changed.\n\n")
	for _, pr := range prs {
		fmt.Fprintf(&b, "* %s ([#%d](%s))\n", pr.Title, pr.Number, pr.URL)
	}
	return b.String()
}

func withoutSection(notes string) string {
	loc := sectionStart.FindStringIndex(notes)
	if loc == nil {
		return notes
	}
	start := loc[0]
	rest := notes[start+len(Heading):]
	end := len(rest)
	for _, next := range []string{"\n## ", "\n### "} {
		if i := strings.Index(rest, next); i >= 0 && i < end {
			end = i
		}
	}
	return notes[:start] + rest[end:]
}
