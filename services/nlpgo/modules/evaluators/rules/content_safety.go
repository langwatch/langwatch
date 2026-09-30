package rules

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/channels"
)

// The character limits langevals_azure cut its texts at.
const (
	contentSafetyMaxChars  = 10000
	jailbreakChunkChars    = 1000
	promptShieldChunkChars = 10000
)

// ContentSafetyCategories are the enabled categories, in the settings' order.
func ContentSafetyCategories(c AzureContentSafetyCategories) []string {
	var names []string
	for _, category := range []struct {
		name    string
		enabled bool
	}{{"Hate", c.Hate}, {"SelfHarm", c.SelfHarm}, {"Sexual", c.Sexual}, {"Violence", c.Violence}} {
		if category.enabled {
			names = append(names, category.name)
		}
	}
	return names
}

// ContentSafetyText is what langevals analyzed: input and output joined by a
// blank line, trimmed, cut at 10000 characters. Empty means skip.
func ContentSafetyText(input, output *string) string {
	joined := strings.TrimSpace(textOf(input) + "\n\n" + textOf(output))
	return string(firstRunes([]rune(joined), contentSafetyMaxChars))
}

// ContentSafetyVerdict scores the highest severity; a severity at or over
// the threshold fails the entry and is named in details, in the vendor's order.
func ContentSafetyVerdict(analysis []channels.CategorySeverity, threshold int) (score float64, passed bool, details string) {
	highest := 0
	var named []string
	for _, item := range analysis {
		highest = max(highest, item.Severity)
		if item.Severity >= threshold {
			named = append(named, fmt.Sprintf("%s (severity %d)", item.Category, item.Severity))
		}
	}
	if len(named) > 0 {
		details = "Detected " + strings.Join(named, ", ")
	}
	return float64(highest), highest < threshold, details
}

// ContentSafetyError is the Azure SDK's exception for a failed status: its
// class, and its message from the vendor's OData error body when it has one.
func ContentSafetyError(status int, body string) (errorType, details string) {
	switch status {
	case http.StatusUnauthorized:
		errorType = "ClientAuthenticationError"
	case http.StatusNotFound:
		errorType = "ResourceNotFoundError"
	case http.StatusConflict:
		errorType = "ResourceExistsError"
	default:
		errorType = "HttpResponseError"
	}
	var odata struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if json.Unmarshal([]byte(body), &odata) == nil && odata.Error.Code != "" {
		e := odata.Error
		return errorType, fmt.Sprintf("(%s) %s\nCode: %s\nMessage: %s", e.Code, e.Message, e.Code, e.Message)
	}
	return errorType, fmt.Sprintf("Operation returned an invalid status '%s'", http.StatusText(status))
}

// AzureRawError is langevals_azure's own error for the routes it posts to by
// hand (jailbreak, prompt shield): a ValueError quoting the body.
func AzureRawError(body string) (errorType, details string) {
	return "ValueError", "Error in API response: " + body
}

// JailbreakChunks are the 1000-character pieces langevals checked one by one.
func JailbreakChunks(text string) []string {
	return runeChunks(text, jailbreakChunkChars)
}

// PromptShieldBatch is one shieldPrompt call: a piece of the prompt and its
// share of the contexts.
type PromptShieldBatch struct {
	UserPrompt string
	Documents  []string
}

// PromptShieldBatches splits the prompt into 10000-character pieces and
// spreads the contexts evenly over them, as langevals did.
func PromptShieldBatches(input string, contexts []string) []PromptShieldBatch {
	chunks := runeChunks(input, promptShieldChunkChars)
	batchSize := max(1, ceilDiv(len(contexts), max(1, len(chunks))))
	batches := make([]PromptShieldBatch, len(chunks))
	for k, chunk := range chunks {
		start := min(k*batchSize, len(contexts))
		end := max(start, min((k+1)*batchSize, len(contexts)))
		batches[k] = PromptShieldBatch{UserPrompt: chunk, Documents: contexts[start:end]}
	}
	return batches
}

// PromptShieldDetails names what was detected; empty when nothing was.
func PromptShieldDetails(promptAttack, documentAttack bool) string {
	switch {
	case promptAttack && documentAttack:
		return "User Prompt Injection attempt and Malicious Contexts detected"
	case promptAttack:
		return "User Prompt Injection attempt detected"
	case documentAttack:
		return "Malicious Contexts detected"
	default:
		return ""
	}
}

// runeChunks cuts text into pieces of size characters (code points, as
// Python slices).
func runeChunks(text string, size int) []string {
	runes := []rune(text)
	var chunks []string
	for len(runes) > 0 {
		chunk := firstRunes(runes, size)
		chunks = append(chunks, string(chunk))
		runes = runes[len(chunk):]
	}
	return chunks
}

func firstRunes(runes []rune, n int) []rune {
	return runes[:min(n, len(runes))]
}

func ceilDiv(a, b int) int {
	return (a + b - 1) / b
}

// textOf is Python's `value or ""`.
func textOf(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
