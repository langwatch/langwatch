package channels

import (
	"context"
	"strconv"
)

// VendorChannel calls the safety vendors. Every request carries the tenant's
// own key and endpoint; the channel holds no credentials of its own.
type VendorChannel interface {
	Moderate(ctx context.Context, req ModerationRequest) (ModerationResponse, error)
	AnalyzeText(ctx context.Context, req ContentSafetyRequest) (ContentSafetyResponse, error)
	DetectJailbreak(ctx context.Context, req JailbreakRequest) (JailbreakResponse, error)
	ShieldPrompt(ctx context.Context, req PromptShieldRequest) (PromptShieldResponse, error)
}

// AzureCredentials are the tenant's Azure Content Safety resource.
type AzureCredentials struct {
	Endpoint string
	Key      string
}

// ModerationRequest is one OpenAI moderation call over several texts.
type ModerationRequest struct {
	APIKey string
	Inputs []string
}

// ModerationResponse holds one result per input, in order.
type ModerationResponse struct {
	Results []ModerationResult
}

// ModerationResult is one input's category scores, keyed as OpenAI names
// them ("self-harm/intent").
type ModerationResult struct {
	CategoryScores map[string]float64
}

// ContentSafetyRequest is one Azure text:analyze call.
type ContentSafetyRequest struct {
	Azure      AzureCredentials
	Text       string
	Categories []string
	OutputType string
}

// ContentSafetyResponse is the severity per analyzed category, in the
// vendor's order.
type ContentSafetyResponse struct {
	Categories []CategorySeverity
}

// CategorySeverity is one category's severity.
type CategorySeverity struct {
	Category string
	Severity int
}

// JailbreakRequest is one Azure text:detectJailbreak call.
type JailbreakRequest struct {
	Azure AzureCredentials
	Text  string
}

// JailbreakResponse says whether the text is a jailbreak attempt.
type JailbreakResponse struct {
	Detected bool
}

// PromptShieldRequest is one Azure text:shieldPrompt call.
type PromptShieldRequest struct {
	Azure      AzureCredentials
	UserPrompt string
	Documents  []string
}

// PromptShieldResponse says which parts carry an attack.
type PromptShieldResponse struct {
	UserPromptAttack bool
	DocumentAttacks  []bool
}

// VendorError is a vendor's non-2xx answer. Error() omits the body so a
// logged error never carries it; Body is for the tenant's own result.
type VendorError struct {
	Status int
	Body   string
}

// Error names the status only.
func (e *VendorError) Error() string {
	return "vendor answered status " + strconv.Itoa(e.Status)
}
