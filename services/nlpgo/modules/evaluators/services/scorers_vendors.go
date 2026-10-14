package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/channels"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/rules"
)

// The tenant env names the vendor evaluators read (TS fills them: the
// install's OpenAI key, the project's azure_safety provider).
const (
	envOpenAIAPIKey        = "OPENAI_API_KEY"
	envAzureSafetyEndpoint = "AZURE_CONTENT_SAFETY_ENDPOINT"
	envAzureSafetyKey      = "AZURE_CONTENT_SAFETY_KEY"
)

// vendorPrepares are the evaluators that call a vendor or embeddings, keyed on slug.
func vendorPrepares() map[string]func(json.RawMessage) (Score, error) {
	return map[string]func(json.RawMessage) (Score, error){
		"openai/moderation":      WithSettings(rules.ParseOpenAIModerationSettings, scoreModeration),
		"azure/content_safety":   WithSettings(rules.ParseAzureContentSafetySettings, scoreContentSafety),
		"azure/jailbreak":        WithSettings(rules.ParseNoSettings, scoreJailbreak),
		"azure/prompt_injection": WithSettings(rules.ParseNoSettings, scorePromptInjection),
		"langevals/similarity":   WithSettings(rules.ParseCustomSimilaritySettings, scoreSimilarity),
		"langevals/sentiment":    WithSettings(rules.ParseSentimentSettings, scoreSentiment),
	}
}

func scoreModeration(ctx context.Context, settings rules.OpenAIModerationSettings, in EntryRun) (contract.Result, error) {
	key, err := tenantVariable(in, envOpenAIAPIKey)
	if err != nil {
		return vendorResult(err)
	}
	input, output := entryText(in.Entry.Input), entryText(in.Entry.Output)
	if input == "" && output == "" {
		return skippedResult("Input and output are both empty"), nil
	}
	resp, err := in.Models.service.vendor.Moderate(ctx, channels.ModerationRequest{APIKey: key, Inputs: []string{input, output}})
	if err != nil {
		return vendorResult(openAIFailure(err))
	}
	if len(resp.Results) < 2 {
		return errorResult("ModerationResultMissing", "The moderation API answered fewer entries than were sent, so this entry has no result."), nil
	}
	score, passed, details := rules.ModerationVerdict(resp.Results[0].CategoryScores, resp.Results[1].CategoryScores, settings.Categories)
	return vendorVerdict(score, passed, details), nil
}

func scoreContentSafety(ctx context.Context, settings rules.AzureContentSafetySettings, in EntryRun) (contract.Result, error) {
	azure, err := azureCredentials(in)
	if err != nil {
		return vendorResult(err)
	}
	text := rules.ContentSafetyText(in.Entry.Input, in.Entry.Output)
	if text == "" {
		return skippedResult("Input and output are both empty"), nil
	}
	resp, err := in.Models.service.vendor.AnalyzeText(ctx, channels.ContentSafetyRequest{
		Azure:      azure,
		Text:       text,
		Categories: rules.ContentSafetyCategories(settings.Categories),
		OutputType: settings.OutputType,
	})
	if err != nil {
		return vendorResult(azureSDKFailure(err))
	}
	score, passed, details := rules.ContentSafetyVerdict(resp.Categories, settings.SeverityThreshold)
	return vendorVerdict(score, passed, details), nil
}

func scoreJailbreak(ctx context.Context, _ rules.NoSettings, in EntryRun) (contract.Result, error) {
	azure, err := azureCredentials(in)
	if err != nil {
		return vendorResult(err)
	}
	content := entryText(in.Entry.Input)
	if content == "" {
		return skippedResult("Input is empty"), nil
	}
	detected := false
	for _, chunk := range rules.JailbreakChunks(content) {
		resp, err := in.Models.service.vendor.DetectJailbreak(ctx, channels.JailbreakRequest{Azure: azure, Text: chunk})
		if err != nil {
			return vendorResult(azureRawFailure(err))
		}
		if detected = resp.Detected; detected {
			break
		}
	}
	details := ""
	if detected {
		details = "Jailbreak attempt detected"
	}
	return vendorVerdict(boolScore(detected), !detected, details), nil
}

func scorePromptInjection(ctx context.Context, _ rules.NoSettings, in EntryRun) (contract.Result, error) {
	azure, err := azureCredentials(in)
	if err != nil {
		return vendorResult(err)
	}
	content := entryText(in.Entry.Input)
	if content == "" {
		return skippedResult("Input is empty"), nil
	}
	contexts, ok := stringList(in.Entry.Contexts)
	if !ok {
		return errorResult("ValidationError", "contexts must be a list of strings"), nil
	}
	batches := rules.PromptShieldBatches(content, contexts)
	requests := make([]channels.PromptShieldRequest, len(batches))
	for i, batch := range batches {
		requests[i] = channels.PromptShieldRequest{Azure: azure, UserPrompt: batch.UserPrompt, Documents: batch.Documents}
	}
	promptAttack, documentAttack, err := shieldPrompt(ctx, in.Models.service.vendor, requests)
	if err != nil {
		return vendorResult(azureRawFailure(err))
	}
	detected := promptAttack || documentAttack
	return vendorVerdict(boolScore(detected), !detected, rules.PromptShieldDetails(promptAttack, documentAttack)), nil
}

// shieldPrompt checks batch after batch until one carries an attack. The
// prompt verdict is the last batch's; a document attack anywhere counts.
func shieldPrompt(ctx context.Context, vendor channels.VendorChannel, requests []channels.PromptShieldRequest) (promptAttack, documentAttack bool, err error) {
	for _, req := range requests {
		resp, callErr := vendor.ShieldPrompt(ctx, req)
		if callErr != nil {
			return false, false, callErr
		}
		promptAttack = resp.UserPromptAttack
		documentAttack = documentAttack || slices.Contains(resp.DocumentAttacks, true)
		if promptAttack || documentAttack {
			break
		}
	}
	return promptAttack, documentAttack, nil
}

func scoreSimilarity(ctx context.Context, settings rules.CustomSimilaritySettings, in EntryRun) (contract.Result, error) {
	content := rules.SimilarityContent(settings, in.Entry.Input, in.Entry.Output)
	if content == "" {
		return skippedResult("No content to evaluate"), nil
	}
	vectors, err := embedTexts(ctx, in, channels.EmbeddingRequest{Model: settings.EmbeddingsModel, Inputs: []string{settings.Value, content}})
	if err != nil {
		return contract.Result{}, err
	}
	similarity := rules.CosineSimilarity(vectors[0], vectors[1])
	passed, details := rules.SimilarityVerdict(settings, similarity)
	return contract.Result{Status: contract.StatusProcessed, Score: &similarity, Passed: &passed, Details: &details}, nil
}

func scoreSentiment(ctx context.Context, settings rules.SentimentSettings, in EntryRun) (contract.Result, error) {
	input := entryText(in.Entry.Input)
	if input == "" {
		return skippedResult("No input text to evaluate"), nil
	}
	vectors, err := embedTexts(ctx, in, channels.EmbeddingRequest{
		Model:  settings.EmbeddingsModel,
		Inputs: []string{input, settings.PositiveReference, settings.NegativeReference},
	})
	if err != nil {
		return contract.Result{}, err
	}
	score, label, details := rules.SentimentVerdict(rules.SentimentVectors{Input: vectors[0], Positive: vectors[1], Negative: vectors[2]}, settings.NormalizationFactor)
	return contract.Result{Status: contract.StatusProcessed, Score: &score, Label: &label, Details: &details}, nil
}

// embedTexts embeds every input in one traced, costed call and checks the
// model answered a vector for each.
func embedTexts(ctx context.Context, in EntryRun, req channels.EmbeddingRequest) ([][]float64, error) {
	resp, err := in.Models.Embed(ctx, req)
	if err != nil {
		return nil, err
	}
	if len(resp.Vectors) != len(req.Inputs) {
		return nil, fmt.Errorf("the embeddings model answered %d vectors for %d texts", len(resp.Vectors), len(req.Inputs))
	}
	return resp.Vectors, nil
}

// Embed makes one embeddings call for the tenant with its
// X_LITELLM_EMBEDDINGS_* credentials, traced and costed as Complete is.
func (m *Models) Embed(ctx context.Context, req channels.EmbeddingRequest) (channels.EmbeddingResponse, error) {
	req.Tenant = m.tenant
	end := m.service.startCallSpan(ctx, channels.CallSpan{Kind: "embeddings", Model: req.Model})
	resp, err := m.service.llm.Embed(ctx, req)
	m.record(req.Model, resp.Usage, resp.CostUSD)
	end(channels.CallOutcome{Usage: resp.Usage, CostUSD: resp.CostUSD, Err: err})
	return resp, err
}

// vendorFailure is an entry error named as langevals named it.
type vendorFailure struct {
	errorType string
	details   string
}

func (f *vendorFailure) Error() string { return f.errorType }

// vendorResult answers a vendorFailure as the entry's error result; any other
// error (transport, deadline) goes back to the service to classify.
func vendorResult(err error) (contract.Result, error) {
	var failure *vendorFailure
	if errors.As(err, &failure) {
		return errorResult(failure.errorType, failure.details), nil
	}
	return contract.Result{}, err
}

// tenantVariable reads one variable from the tenant's env, never the
// process's. Missing is langevals' EnvMissingException, before any call.
func tenantVariable(in EntryRun, name string) (string, error) {
	if value := in.Models.tenant.Env[name]; value != "" {
		return value, nil
	}
	return "", &vendorFailure{errorType: "EnvMissingException", details: "Variable " + name + " not defined in environment."}
}

func azureCredentials(in EntryRun) (channels.AzureCredentials, error) {
	endpoint, err := tenantVariable(in, envAzureSafetyEndpoint)
	if err != nil {
		return channels.AzureCredentials{}, err
	}
	key, err := tenantVariable(in, envAzureSafetyKey)
	if err != nil {
		return channels.AzureCredentials{}, err
	}
	return channels.AzureCredentials{Endpoint: endpoint, Key: key}, nil
}

func openAIFailure(err error) error {
	var vendorErr *channels.VendorError
	if !errors.As(err, &vendorErr) {
		return err
	}
	return &vendorFailure{rules.OpenAIErrorType(vendorErr.Status), rules.OpenAIErrorDetails(vendorErr.Status, vendorErr.Body)}
}

func azureSDKFailure(err error) error {
	var vendorErr *channels.VendorError
	if !errors.As(err, &vendorErr) {
		return err
	}
	errorType, details := rules.ContentSafetyError(vendorErr.Status, vendorErr.Body)
	return &vendorFailure{errorType, details}
}

func azureRawFailure(err error) error {
	var vendorErr *channels.VendorError
	if !errors.As(err, &vendorErr) {
		return err
	}
	errorType, details := rules.AzureRawError(vendorErr.Body)
	return &vendorFailure{errorType, details}
}

func errorResult(errorType, details string) contract.Result {
	return contract.Result{Status: contract.StatusError, ErrorType: errorType, Details: &details, Traceback: []string{}}
}

func skippedResult(details string) contract.Result {
	return contract.Result{Status: contract.StatusSkipped, Details: &details}
}

// vendorVerdict is a processed result; empty details stay unset, as Python's None.
func vendorVerdict(score float64, passed bool, details string) contract.Result {
	result := contract.Result{Status: contract.StatusProcessed, Score: &score, Passed: &passed}
	if details != "" {
		result.Details = &details
	}
	return result
}

func boolScore(value bool) float64 {
	if value {
		return 1
	}
	return 0
}

// entryText is Python's `value or ""`.
func entryText(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

// stringList decodes an optional JSON list of strings; ok is false when it is
// present but not one.
func stringList(raw json.RawMessage) (list []string, ok bool) {
	if len(raw) == 0 {
		return nil, true
	}
	return list, json.Unmarshal(raw, &list) == nil
}
