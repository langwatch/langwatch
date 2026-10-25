package memory

import (
	"context"
	"errors"
	"sync"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/channels"
)

// Vendor is the VendorChannel twin. It counts every call it receives and
// fails by name on any call a test did not script.
type Vendor struct {
	mu        sync.Mutex
	calls     int
	moderate  func(context.Context, channels.ModerationRequest) (channels.ModerationResponse, error)
	analyze   func(context.Context, channels.ContentSafetyRequest) (channels.ContentSafetyResponse, error)
	jailbreak func(context.Context, channels.JailbreakRequest) (channels.JailbreakResponse, error)
	shield    func(context.Context, channels.PromptShieldRequest) (channels.PromptShieldResponse, error)
}

var _ channels.VendorChannel = (*Vendor)(nil)

// NewVendor returns a twin with nothing scripted.
func NewVendor() *Vendor { return &Vendor{} }

// ScriptModerate sets how Moderate answers.
func (v *Vendor) ScriptModerate(fn func(context.Context, channels.ModerationRequest) (channels.ModerationResponse, error)) {
	v.mu.Lock()
	defer v.mu.Unlock()
	v.moderate = fn
}

// ScriptAnalyzeText sets how AnalyzeText answers.
func (v *Vendor) ScriptAnalyzeText(fn func(context.Context, channels.ContentSafetyRequest) (channels.ContentSafetyResponse, error)) {
	v.mu.Lock()
	defer v.mu.Unlock()
	v.analyze = fn
}

// ScriptDetectJailbreak sets how DetectJailbreak answers.
func (v *Vendor) ScriptDetectJailbreak(fn func(context.Context, channels.JailbreakRequest) (channels.JailbreakResponse, error)) {
	v.mu.Lock()
	defer v.mu.Unlock()
	v.jailbreak = fn
}

// ScriptShieldPrompt sets how ShieldPrompt answers.
func (v *Vendor) ScriptShieldPrompt(fn func(context.Context, channels.PromptShieldRequest) (channels.PromptShieldResponse, error)) {
	v.mu.Lock()
	defer v.mu.Unlock()
	v.shield = fn
}

// Calls is how many vendor calls were made, scripted or not.
func (v *Vendor) Calls() int {
	v.mu.Lock()
	defer v.mu.Unlock()
	return v.calls
}

// Moderate answers from the script.
func (v *Vendor) Moderate(ctx context.Context, req channels.ModerationRequest) (channels.ModerationResponse, error) {
	v.mu.Lock()
	v.calls++
	fn := v.moderate
	v.mu.Unlock()
	if fn == nil {
		return channels.ModerationResponse{}, errors.New("memory.Vendor: Moderate is not scripted")
	}
	return fn(ctx, req)
}

// AnalyzeText answers from the script.
func (v *Vendor) AnalyzeText(ctx context.Context, req channels.ContentSafetyRequest) (channels.ContentSafetyResponse, error) {
	v.mu.Lock()
	v.calls++
	fn := v.analyze
	v.mu.Unlock()
	if fn == nil {
		return channels.ContentSafetyResponse{}, errors.New("memory.Vendor: AnalyzeText is not scripted")
	}
	return fn(ctx, req)
}

// DetectJailbreak answers from the script.
func (v *Vendor) DetectJailbreak(ctx context.Context, req channels.JailbreakRequest) (channels.JailbreakResponse, error) {
	v.mu.Lock()
	v.calls++
	fn := v.jailbreak
	v.mu.Unlock()
	if fn == nil {
		return channels.JailbreakResponse{}, errors.New("memory.Vendor: DetectJailbreak is not scripted")
	}
	return fn(ctx, req)
}

// ShieldPrompt answers from the script.
func (v *Vendor) ShieldPrompt(ctx context.Context, req channels.PromptShieldRequest) (channels.PromptShieldResponse, error) {
	v.mu.Lock()
	v.calls++
	fn := v.shield
	v.mu.Unlock()
	if fn == nil {
		return channels.PromptShieldResponse{}, errors.New("memory.Vendor: ShieldPrompt is not scripted")
	}
	return fn(ctx, req)
}
