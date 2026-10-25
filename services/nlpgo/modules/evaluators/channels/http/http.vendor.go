package http

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/langwatch/langwatch/pkg/ssrf"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/channels"
)

// The vendor API versions langevals called (azure-ai-contentsafety 1.0.0 and
// the two preview routes langevals_azure posts to by hand).
const (
	defaultOpenAIBaseURL       = "https://api.openai.com/v1"
	analyzeTextOperation       = "text:analyze?api-version=2023-10-01"
	detectJailbreakOperation   = "text:detectJailbreak?api-version=2023-10-15-preview"
	shieldPromptOperation      = "text:shieldPrompt?api-version=2024-02-15-preview"
	maxVendorResponseBodyBytes = 4 << 20
)

// VendorOptions configures NewVendor.
type VendorOptions struct {
	// OpenAIBaseURL is the moderation API's base; empty is OpenAI's own.
	OpenAIBaseURL string
	// Egress is the deployment's policy; its zero value refuses local calls.
	Egress ssrf.Options
}

// Vendor calls the safety vendors over the safe dialer, with the key and
// endpoint each request carries.
type Vendor struct {
	client        *http.Client
	openAIBaseURL string
}

var _ channels.VendorChannel = (*Vendor)(nil)

// NewVendor builds the channel. No proxy (a proxy would dial for us, past the
// dialer's check) and no redirects (they would carry the key elsewhere).
func NewVendor(opts VendorOptions) *Vendor {
	base := opts.OpenAIBaseURL
	if base == "" {
		base = defaultOpenAIBaseURL
	}
	transport := &http.Transport{
		Proxy:               nil,
		DialContext:         ssrf.SafeDialer(opts.Egress),
		ForceAttemptHTTP2:   true,
		TLSHandshakeTimeout: 10 * time.Second,
		IdleConnTimeout:     90 * time.Second,
	}
	return &Vendor{
		client: &http.Client{
			Transport:     transport,
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
		openAIBaseURL: strings.TrimRight(base, "/"),
	}
}

// Moderate posts the inputs to OpenAI's moderation API.
func (v *Vendor) Moderate(ctx context.Context, req channels.ModerationRequest) (channels.ModerationResponse, error) {
	var wire struct {
		Results []struct {
			CategoryScores map[string]float64 `json:"category_scores"`
		} `json:"results"`
	}
	call := vendorCall{
		url:    v.openAIBaseURL + "/moderations",
		header: http.Header{"Authorization": {"Bearer " + req.APIKey}},
		body:   map[string]any{"input": req.Inputs},
	}
	if err := v.post(ctx, call, &wire); err != nil {
		return channels.ModerationResponse{}, err
	}
	out := channels.ModerationResponse{Results: make([]channels.ModerationResult, len(wire.Results))}
	for i, result := range wire.Results {
		out.Results[i] = channels.ModerationResult{CategoryScores: result.CategoryScores}
	}
	return out, nil
}

// AnalyzeText posts one text to Azure Content Safety's text:analyze.
func (v *Vendor) AnalyzeText(ctx context.Context, req channels.ContentSafetyRequest) (channels.ContentSafetyResponse, error) {
	var wire struct {
		CategoriesAnalysis []struct {
			Category string `json:"category"`
			Severity int    `json:"severity"`
		} `json:"categoriesAnalysis"`
	}
	body := map[string]any{"text": req.Text, "categories": nonNil(req.Categories), "outputType": req.OutputType}
	if err := v.post(ctx, azureCall(req.Azure, analyzeTextOperation, body), &wire); err != nil {
		return channels.ContentSafetyResponse{}, err
	}
	out := channels.ContentSafetyResponse{Categories: make([]channels.CategorySeverity, len(wire.CategoriesAnalysis))}
	for i, item := range wire.CategoriesAnalysis {
		out.Categories[i] = channels.CategorySeverity{Category: item.Category, Severity: item.Severity}
	}
	return out, nil
}

// DetectJailbreak posts one chunk to Azure Content Safety's text:detectJailbreak.
func (v *Vendor) DetectJailbreak(ctx context.Context, req channels.JailbreakRequest) (channels.JailbreakResponse, error) {
	var wire struct {
		JailbreakAnalysis struct {
			Detected bool `json:"detected"`
		} `json:"jailbreakAnalysis"`
	}
	body := map[string]any{"text": req.Text}
	if err := v.post(ctx, azureCall(req.Azure, detectJailbreakOperation, body), &wire); err != nil {
		return channels.JailbreakResponse{}, err
	}
	return channels.JailbreakResponse{Detected: wire.JailbreakAnalysis.Detected}, nil
}

// ShieldPrompt posts one prompt and its documents to Azure Content Safety's text:shieldPrompt.
func (v *Vendor) ShieldPrompt(ctx context.Context, req channels.PromptShieldRequest) (channels.PromptShieldResponse, error) {
	var wire struct {
		UserPromptAnalysis struct {
			AttackDetected bool `json:"attackDetected"`
		} `json:"userPromptAnalysis"`
		DocumentsAnalysis []struct {
			AttackDetected bool `json:"attackDetected"`
		} `json:"documentsAnalysis"`
	}
	body := map[string]any{"userPrompt": req.UserPrompt, "documents": nonNil(req.Documents)}
	if err := v.post(ctx, azureCall(req.Azure, shieldPromptOperation, body), &wire); err != nil {
		return channels.PromptShieldResponse{}, err
	}
	out := channels.PromptShieldResponse{
		UserPromptAttack: wire.UserPromptAnalysis.AttackDetected,
		DocumentAttacks:  make([]bool, len(wire.DocumentsAnalysis)),
	}
	for i, doc := range wire.DocumentsAnalysis {
		out.DocumentAttacks[i] = doc.AttackDetected
	}
	return out, nil
}

// vendorCall is one JSON POST.
type vendorCall struct {
	url    string
	header http.Header
	body   any
}

func azureCall(azure channels.AzureCredentials, operation string, body any) vendorCall {
	return vendorCall{
		url:    strings.TrimRight(azure.Endpoint, "/") + "/contentsafety/" + operation,
		header: http.Header{"Ocp-Apim-Subscription-Key": {azure.Key}},
		body:   body,
	}
}

// post sends call and decodes a 2xx answer into out. A non-2xx answer is a
// *channels.VendorError. Transport errors drop the URL, which names the
// tenant's endpoint, keeping only the cause.
func (v *Vendor) post(ctx context.Context, call vendorCall, out any) error {
	payload, err := json.Marshal(call.body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, call.url, bytes.NewReader(payload))
	if err != nil {
		return errors.New("the vendor endpoint is not a valid URL")
	}
	req.Header = call.header
	req.Header.Set("Content-Type", "application/json")
	resp, err := v.client.Do(req)
	if err != nil {
		return fmt.Errorf("vendor request failed: %w", withoutURL(err))
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxVendorResponseBodyBytes))
	if err != nil {
		return fmt.Errorf("vendor response unreadable: %w", withoutURL(err))
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return &channels.VendorError{Status: resp.StatusCode, Body: string(body)}
	}
	if err := json.Unmarshal(body, out); err != nil {
		return errors.New("the vendor answered with a body that is not the expected JSON")
	}
	return nil
}

func withoutURL(err error) error {
	var urlErr *url.Error
	if errors.As(err, &urlErr) {
		return urlErr.Err
	}
	return err
}

// nonNil keeps an empty list a JSON [] as Python sent it, never null.
func nonNil(values []string) []string {
	if values == nil {
		return []string{}
	}
	return values
}
