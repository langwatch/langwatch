package rules

import (
	"regexp"
	"strings"
)

// CompetitorBlocklist ports langevals_langevals/competitor_blocklist.py: every
// case-insensitive mention in the input, then in the output. A missing or
// empty field is searched as " ", as Python did, which an empty competitor
// name (matching everywhere) makes visible.
func CompetitorBlocklist(settings CompetitorBlocklistSettings, input, output *string) []string {
	escaped := make([]string, len(settings.Competitors))
	for i, competitor := range settings.Competitors {
		escaped[i] = regexp.QuoteMeta(competitor)
	}
	pattern := regexp.MustCompile("(?i)" + strings.Join(escaped, "|"))
	mentions := pattern.FindAllString(orSpace(input), -1)
	return append(mentions, pattern.FindAllString(orSpace(output), -1)...)
}

func orSpace(value *string) string {
	if value == nil || *value == "" {
		return " "
	}
	return *value
}
