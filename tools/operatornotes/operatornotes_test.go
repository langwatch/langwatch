package operatornotes

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

const notes = `## [3.22.0](https://github.com/langwatch/langwatch/compare/a...b) (2026-10-28)

### Features

* **chart:** drop the gateway's own ingress ([#9001](https://github.com/langwatch/langwatch/issues/9001)) ([abc1234](https://github.com/langwatch/langwatch/commit/abc1234))
* **ui:** a new button ([#9002](https://github.com/langwatch/langwatch/issues/9002)) ([def5678](https://github.com/langwatch/langwatch/commit/def5678))

### Bug Fixes

* **api:** a fix ([#9003](https://github.com/langwatch/langwatch/pull/9003))
`

var marked = []PullRequest{
	{Number: 9003, Title: "fix(api): a fix", URL: "https://github.com/langwatch/langwatch/pull/9003"},
	{Number: 9001, Title: "feat(chart): drop the gateway's own ingress", URL: "https://github.com/langwatch/langwatch/pull/9001"},
	{Number: 8000, Title: "an older release's", URL: "https://github.com/langwatch/langwatch/pull/8000"},
}

// @scenario "A release names the operator-action pull requests it ships"
func TestTheSectionListsTheMarkedPullRequestsTheReleaseShips(t *testing.T) {
	got := WithSection(notes, Shipped(notes, marked))

	_, section, found := strings.Cut(got, Heading)
	assert.True(t, found)
	assert.Contains(t, section, "drop the gateway's own ingress ([#9001]")
	assert.Contains(t, section, "a fix ([#9003]")
	assert.NotContains(t, section, "#8000", "a pull request carrying the label this release does not ship is left out")
	assert.Less(t, strings.Index(section, "#9001"), strings.Index(section, "#9003"), "in the changelog's order")
}

// @scenario "A release with no operator-action pull request is left as it is"
func TestNotesWithNoMarkedPullRequestAreUnchanged(t *testing.T) {
	assert.Equal(t, notes, WithSection(notes, Shipped(notes, nil)))
}

// @scenario "Publishing the notes twice does not repeat the section"
func TestWritingTheSectionAgainReplacesIt(t *testing.T) {
	once := WithSection(notes, Shipped(notes, marked))
	twice := WithSection(once, Shipped(once, marked[:1]))

	assert.Equal(t, 1, strings.Count(twice, Heading))
	_, section, _ := strings.Cut(twice, Heading)
	assert.NotContains(t, section, "#9001]", "the section is rewritten, not appended to")
	assert.Equal(t, notes, WithSection(once, nil), "an emptied list removes the section")
}
