package providers

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/bytedance/sonic"
	bfschemas "github.com/maximhq/bifrost/core/schemas"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// imageGenerationWireRequest is the OpenAI /v1/images/generations wire shape.
// Bifrost's ImageGenerationRequest takes a structured input, so the gateway
// parses the JSON here, the same way the speech route does.
//
// Every optional field is a pointer so it reaches the provider only when the
// caller sent it. response_format matters most: the gpt-image family rejects
// the field outright while dall-e-3 needs it, so the gateway forwards the
// caller's choice and never invents one.
type imageGenerationWireRequest struct {
	Model             string  `json:"model"`
	Prompt            string  `json:"prompt"`
	N                 *int    `json:"n,omitempty"`
	Size              *string `json:"size,omitempty"`
	Quality           *string `json:"quality,omitempty"`
	Background        *string `json:"background,omitempty"`
	Moderation        *string `json:"moderation,omitempty"`
	OutputFormat      *string `json:"output_format,omitempty"`
	OutputCompression *int    `json:"output_compression,omitempty"`
	ResponseFormat    *string `json:"response_format,omitempty"`
	Style             *string `json:"style,omitempty"`
	User              *string `json:"user,omitempty"`
}

// imageParams maps the wire request onto Bifrost's generation parameters.
func (w imageGenerationWireRequest) imageParams() *bfschemas.ImageGenerationParameters {
	return &bfschemas.ImageGenerationParameters{
		N:                 w.N,
		Background:        w.Background,
		Moderation:        w.Moderation,
		Size:              w.Size,
		Quality:           w.Quality,
		OutputCompression: w.OutputCompression,
		OutputFormat:      w.OutputFormat,
		Style:             w.Style,
		ResponseFormat:    w.ResponseFormat,
		User:              w.User,
	}
}

// imageEditParams maps the allowlisted form fields onto Bifrost's edit
// parameters. A field the caller did not send stays nil, so the provider sees
// its own defaults.
func imageEditParams(upload *domain.ImageEditUpload) *bfschemas.ImageEditParameters {
	params := &bfschemas.ImageEditParameters{Mask: upload.Mask}
	if v := upload.Params["background"]; v != "" {
		params.Background = &v
	}
	if v := upload.Params["input_fidelity"]; v != "" {
		params.InputFidelity = &v
	}
	if v := upload.Params["output_format"]; v != "" {
		params.OutputFormat = &v
	}
	if v := upload.Params["quality"]; v != "" {
		params.Quality = &v
	}
	if v := upload.Params["response_format"]; v != "" {
		params.ResponseFormat = &v
	}
	if v := upload.Params["size"]; v != "" {
		params.Size = &v
	}
	if v := upload.Params["user"]; v != "" {
		params.User = &v
	}
	if n, err := strconv.Atoi(upload.Params["n"]); err == nil {
		params.N = &n
	}
	if c, err := strconv.Atoi(upload.Params["output_compression"]); err == nil {
		params.OutputCompression = &c
	}
	return params
}

// imageEndpointSupported refuses the OpenAI-compatible generic provider, which
// answers every image call with an unsupported-operation error.
//
// An OpenAI credential carrying a base_url override routes there (mapProvider),
// and so do the custom and DeepSeek credentials. A caller reaching this with a
// self-hosted endpoint needs to be told which credential does serve images
// rather than reading the adapter's own refusal.
func imageEndpointSupported(ctx context.Context, provider bfschemas.ModelProvider) error {
	if provider != bfschemas.VLLM {
		return nil
	}
	return herr.New(ctx, domain.ErrBadRequest, herr.M{
		"message": "image endpoints need a direct OpenAI, Azure OpenAI, Gemini, Vertex or Bedrock " +
			"credential; an OpenAI credential with a custom base URL is not supported for images",
	})
}

// imageDispatchContext carries the credential plus the raw-response flag, so a
// provider refusal reaches the caller in the vendor's own error envelope
// instead of a rewritten one. Image SDKs read that envelope for the moderation
// and size messages the vendor states there.
func imageDispatchContext(ctx context.Context, cred domain.Credential) *bfschemas.BifrostContext {
	ctx = withCredential(ctx, cred)
	ctx = context.WithValue(ctx, bfschemas.BifrostContextKeySendBackRawResponse, true)
	return bfschemas.NewBifrostContext(ctx, time.Time{})
}

// dispatchImageGeneration routes /v1/images/generations traffic through
// Bifrost's ImageGenerationRequest endpoint. The success body is the OpenAI
// images JSON, whose data[] entries carry the base64 images.
//
//nolint:revive // argument-limit: the same five values dispatchSpeech beside it takes.
func (r *BifrostRouter) dispatchImageGeneration(
	ctx context.Context,
	req *domain.Request,
	provider bfschemas.ModelProvider,
	model string,
	cred domain.Credential,
) (*domain.Response, error) {
	if err := imageEndpointSupported(ctx, provider); err != nil {
		return nil, err
	}

	var wire imageGenerationWireRequest
	if err := sonic.Unmarshal(req.Body, &wire); err != nil {
		return nil, herr.New(ctx, domain.ErrBadRequest, herr.M{"reason": "invalid JSON body: " + err.Error()})
	}
	if wire.Prompt == "" {
		return nil, herr.New(ctx, domain.ErrBadRequest, herr.M{"reason": "missing required field: prompt"})
	}

	bfReq := &bfschemas.BifrostImageGenerationRequest{
		Provider: provider,
		Model:    model,
		Input:    &bfschemas.ImageGenerationInput{Prompt: wire.Prompt},
		Params:   wire.imageParams(),
	}
	bfCtx := imageDispatchContext(ctx, cred)

	resp, berr := r.bf.ImageGenerationRequest(bfCtx, bfReq)
	if berr != nil {
		if answer, ok := r.responseFromBifrostError(berr, bfCtx); ok {
			return answer, nil
		}
		return nil, errFromBifrost(ctx, berr, bifrostResponseHeaders(bfCtx))
	}

	body, _ := sonic.Marshal(resp)
	return &domain.Response{
		Body:       body,
		StatusCode: http.StatusOK,
		Usage:      extractImageUsage(resp),
	}, nil
}

// dispatchImageEdit routes /v1/images/edits traffic through Bifrost's
// ImageEditRequest endpoint. The router already parsed the multipart form into
// req.ImageEdit, and the prompt rides on the synthesized JSON body every
// pipeline stage reads.
//
//nolint:revive // argument-limit: the same five values dispatchTranscription beside it takes.
func (r *BifrostRouter) dispatchImageEdit(
	ctx context.Context,
	req *domain.Request,
	provider bfschemas.ModelProvider,
	model string,
	cred domain.Credential,
) (*domain.Response, error) {
	if err := imageEndpointSupported(ctx, provider); err != nil {
		return nil, err
	}

	upload := req.ImageEdit
	if upload == nil || len(upload.Images) == 0 {
		return nil, herr.New(ctx, domain.ErrBadRequest, herr.M{"reason": "missing required field: image"})
	}
	prompt := upload.Params["prompt"]
	if prompt == "" {
		return nil, herr.New(ctx, domain.ErrBadRequest, herr.M{"reason": "missing required field: prompt"})
	}

	images := make([]bfschemas.ImageInput, 0, len(upload.Images))
	for _, image := range upload.Images {
		images = append(images, bfschemas.ImageInput{Image: image})
	}

	bfReq := &bfschemas.BifrostImageEditRequest{
		Provider: provider,
		Model:    model,
		Input:    &bfschemas.ImageEditInput{Images: images, Prompt: prompt},
		Params:   imageEditParams(upload),
	}
	bfCtx := imageDispatchContext(ctx, cred)

	resp, berr := r.bf.ImageEditRequest(bfCtx, bfReq)
	if berr != nil {
		if answer, ok := r.responseFromBifrostError(berr, bfCtx); ok {
			return answer, nil
		}
		return nil, errFromBifrost(ctx, berr, bifrostResponseHeaders(bfCtx))
	}

	body, _ := sonic.Marshal(resp)
	return &domain.Response{
		Body:       body,
		StatusCode: http.StatusOK,
		Usage:      extractImageUsage(resp),
	}, nil
}

// extractImageUsage maps Bifrost image usage onto the domain measure. The
// image counts are taken out of the prompt and completion totals, because an
// image token costs about four times a text one and pricing a flat total at
// the text rate charges a fraction of the real call.
func extractImageUsage(resp *bfschemas.BifrostImageGenerationResponse) domain.Usage {
	if resp == nil {
		return domain.Usage{}
	}
	u := domain.Usage{Model: resp.Model, ImageCount: len(resp.Data)}
	if resp.Usage == nil {
		return u
	}
	u.PromptTokens = resp.Usage.InputTokens
	u.CompletionTokens = resp.Usage.OutputTokens
	u.TotalTokens = resp.Usage.TotalTokens

	var split domain.ImageTokenSplit
	if d := resp.Usage.InputTokensDetails; d != nil {
		split.InputImage = d.ImageTokens
		split.InputText = d.TextTokens
	}
	if d := resp.Usage.OutputTokensDetails; d != nil {
		split.OutputImage = d.ImageTokens
		split.OutputText = d.TextTokens
	} else {
		// An image model answers in image tokens. With no breakdown stated,
		// the whole output total is the image side.
		split.OutputImage = resp.Usage.OutputTokens
	}
	return u.SplitImageTokens(split)
}
