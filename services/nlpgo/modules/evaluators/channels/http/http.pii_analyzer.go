package http

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/channels"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
)

// The remote analyzer's defaults: a cap on what it may answer and how long
// it may take.
const (
	defaultPIIAnalyzerTimeout       = 30 * time.Second
	maxPIIAnalyzerResponseBodyBytes = 8 << 20
)

// PIIAnalyzerOptions configures NewPIIAnalyzer from operator config only.
type PIIAnalyzerOptions struct {
	// BaseURL is the model service; "/v1/analyze" is appended.
	BaseURL string
	// Key is sent as a Bearer token. A secret: never logged.
	Key string
	// Covers are the entities the model finds; empty is PERSON and LOCATION.
	Covers  []contract.EntityType
	Timeout time.Duration
}

// PIIAnalyzer is the `remote` analyzer: a Presidio-compatible model service.
type PIIAnalyzer struct {
	client *http.Client
	url    string
	key    string
	covers []contract.EntityType
}

var _ channels.PIIAnalyzer = (*PIIAnalyzer)(nil)

// NewPIIAnalyzer builds the channel. No redirects: they would carry the key.
func NewPIIAnalyzer(opts PIIAnalyzerOptions) *PIIAnalyzer {
	covers := opts.Covers
	if len(covers) == 0 {
		covers = []contract.EntityType{"PERSON", "LOCATION"}
	}
	timeout := opts.Timeout
	if timeout <= 0 {
		timeout = defaultPIIAnalyzerTimeout
	}
	return &PIIAnalyzer{
		client: &http.Client{
			Timeout:       timeout,
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
		url:    strings.TrimRight(opts.BaseURL, "/") + "/v1/analyze",
		key:    opts.Key,
		covers: covers,
	}
}

// Covers are the entities the model finds.
func (a *PIIAnalyzer) Covers() []contract.EntityType { return slices.Clone(a.covers) }

// Analyze posts the text and returns the model's findings. Errors name the
// failure only: never the text, the URL or the answer's body.
func (a *PIIAnalyzer) Analyze(ctx context.Context, req channels.AnalyzeRequest) (channels.AnalyzeResult, error) {
	payload, err := json.Marshal(map[string]any{"text": req.Text, "language": req.Language, "entities": req.Entities})
	if err != nil {
		return channels.AnalyzeResult{}, errors.New("the PII analyzer request could not be encoded")
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, a.url, bytes.NewReader(payload))
	if err != nil {
		return channels.AnalyzeResult{}, errors.New("the PII analyzer URL is not valid")
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+a.key)
	resp, err := a.client.Do(httpReq)
	if err != nil {
		return channels.AnalyzeResult{}, fmt.Errorf("the PII analyzer request failed: %w", withoutURL(err))
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxPIIAnalyzerResponseBodyBytes+1))
	if err != nil {
		return channels.AnalyzeResult{}, fmt.Errorf("the PII analyzer response was unreadable: %w", withoutURL(err))
	}
	if len(body) > maxPIIAnalyzerResponseBodyBytes {
		return channels.AnalyzeResult{}, errors.New("the PII analyzer answered more than the response cap")
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return channels.AnalyzeResult{}, errors.New("the PII analyzer answered status " + strconv.Itoa(resp.StatusCode))
	}
	var findings []contract.PIIFinding
	if err := json.Unmarshal(body, &findings); err != nil {
		return channels.AnalyzeResult{}, errors.New("the PII analyzer answered with a body that is not the expected JSON")
	}
	return channels.AnalyzeResult{Findings: findings}, nil
}
