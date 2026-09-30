package rules

import (
	"fmt"
	"math"
	"net/http"
	"sort"
	"strings"
)

// moderationCategory is one OpenAIModerationCategories field: its settings
// name and the name OpenAI's API gives it.
type moderationCategory struct {
	name    string
	wire    string
	enabled bool
}

// moderationCategories lists the categories in the settings' field order,
// which is the order langevals ranked ties in.
func moderationCategories(c OpenAIModerationCategories) []moderationCategory {
	return []moderationCategory{
		{"harassment", "harassment", c.Harassment},
		{"harassment_threatening", "harassment/threatening", c.HarassmentThreatening},
		{"hate", "hate", c.Hate},
		{"hate_threatening", "hate/threatening", c.HateThreatening},
		{"self_harm", "self-harm", c.SelfHarm},
		{"self_harm_instructions", "self-harm/instructions", c.SelfHarmInstructions},
		{"self_harm_intent", "self-harm/intent", c.SelfHarmIntent},
		{"sexual", "sexual", c.Sexual},
		{"sexual_minors", "sexual/minors", c.SexualMinors},
		{"violence", "violence", c.Violence},
		{"violence_graphic", "violence/graphic", c.ViolenceGraphic},
	}
}

// ModerationVerdict is langevals' moderation arithmetic: each category's
// score is the higher of input and output; the score is the highest of all;
// an enabled category over 0.5 fails the entry and is named in details.
func ModerationVerdict(input, output map[string]float64, enabled OpenAIModerationCategories) (score float64, passed bool, details string) {
	type scored struct {
		name     string
		score    float64
		detected bool
	}
	categories := moderationCategories(enabled)
	all := make([]scored, 0, len(categories))
	for _, c := range categories {
		s := math.Max(input[c.wire], output[c.wire])
		all = append(all, scored{name: c.name, score: s, detected: c.enabled && s > 0.5})
		score = math.Max(score, s)
	}
	sort.SliceStable(all, func(i, j int) bool { return all[i].score > all[j].score })
	var named []string
	for _, c := range all {
		if c.detected {
			named = append(named, fmt.Sprintf("%s (%.2f%% confidence)", c.name, c.score*100))
		}
	}
	if len(named) == 0 {
		return score, true, ""
	}
	return score, false, "Detected " + strings.Join(named, ", ")
}

// OpenAIErrorType is the exception class the OpenAI SDK raises for a status.
func OpenAIErrorType(status int) string {
	switch {
	case status >= http.StatusInternalServerError:
		return "InternalServerError"
	case status == http.StatusBadRequest:
		return "BadRequestError"
	case status == http.StatusUnauthorized:
		return "AuthenticationError"
	case status == http.StatusForbidden:
		return "PermissionDeniedError"
	case status == http.StatusNotFound:
		return "NotFoundError"
	case status == http.StatusConflict:
		return "ConflictError"
	case status == http.StatusUnprocessableEntity:
		return "UnprocessableEntityError"
	case status == http.StatusTooManyRequests:
		return "RateLimitError"
	default:
		return "APIStatusError"
	}
}

// OpenAIErrorDetails is the OpenAI SDK's error message: the status and the
// vendor's body.
func OpenAIErrorDetails(status int, body string) string {
	details := fmt.Sprintf("Error code: %d", status)
	if body != "" {
		details += " - " + body
	}
	return details
}
