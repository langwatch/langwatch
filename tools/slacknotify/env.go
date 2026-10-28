package slacknotify

import (
	"os/exec"
	"path"
	"strings"
)

// WorkflowFile is the file name in a GITHUB_WORKFLOW_REF,
// owner/repo/.github/workflows/<file>@<ref>, or "" for an empty ref.
func WorkflowFile(ref string) string {
	ref, _, _ = strings.Cut(ref, "@")
	if ref == "" {
		return ""
	}

	return path.Base(ref)
}

// OrGit is value, or else the field of dir's checked-out commit in git log's
// format, so a run without a push event still names its commit.
func OrGit(dir, value, format string) string {
	if value != "" {
		return value
	}
	out, err := exec.Command("git", "-C", dir, "log", "-1", "--format="+format).Output() //nolint:gosec // G204: the executable is git; dir and format come from the command, not from the event
	if err != nil {
		return "unknown"
	}

	return strings.TrimSpace(string(out))
}
