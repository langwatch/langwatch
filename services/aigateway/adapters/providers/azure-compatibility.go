package providers

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/bytedance/sonic"
	bfopenai "github.com/maximhq/bifrost/core/providers/openai"
	bfschemas "github.com/maximhq/bifrost/core/schemas"
	"github.com/tidwall/sjson"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Bifrost 1.5 uses Azure's v1 endpoints and removed per-key API versions.
// Existing credentials still name versioned deployment endpoints, so these
// operations use its authenticated passthrough transport with the original URL.
func azureLegacyOperation(typ domain.RequestType) string {
	switch typ {
	case domain.RequestTypeChat:
		return "chat/completions"
	case domain.RequestTypeEmbeddings:
		return "embeddings"
	case domain.RequestTypeSpeech:
		return "audio/speech"
	case domain.RequestTypeTranscription:
		return "audio/transcriptions"
	default:
		return ""
	}
}

type azureCompatibilityTarget struct {
	model      string
	credential domain.Credential
}

var errAzureDeploymentMissing = errors.New("azure deployment mapping is missing")

func azureCompatibilityRequest(req *domain.Request, target azureCompatibilityTarget, stream bool) (*bfschemas.BifrostPassthroughRequest, error) {
	model, cred := target.model, target.credential
	deployment, configured := cred.DeploymentMap[model]
	if !configured {
		return nil, errAzureDeploymentMissing
	}
	version, configured := cred.Extra["api_version"]
	if !configured {
		version = "2024-10-21"
	}
	body, contentType, err := azureCompatibilityBody(req, deployment, stream)
	if err != nil {
		return nil, err
	}
	return &bfschemas.BifrostPassthroughRequest{
		Model: model, Method: http.MethodPost,
		Path:     "/openai/deployments/" + url.PathEscape(deployment) + "/" + azureLegacyOperation(req.Type),
		RawQuery: url.Values{"api-version": {version}}.Encode(),
		Body:     body, SafeHeaders: map[string]string{"Content-Type": contentType},
	}, nil
}

func azureCompatibilityBody(req *domain.Request, model string, stream bool) ([]byte, string, error) {
	switch req.Type {
	case domain.RequestTypeTranscription:
		return azureTranscriptionBody(req.Transcription, model)
	case domain.RequestTypeEmbeddings:
		parsed, err := buildEmbeddingRequest(req, bfschemas.Azure, model)
		if err != nil {
			return nil, "", err
		}
		body, err := sonic.Marshal(bfopenai.ToOpenAIEmbeddingRequest(parsed))
		return body, "application/json", err
	case domain.RequestTypeSpeech:
		var wire speechWireRequest
		if err := sonic.Unmarshal(req.Body, &wire); err != nil {
			return nil, "", err
		}
		if wire.Input == "" {
			return nil, "", fmt.Errorf("missing required field: input")
		}
		wire.Model = model
		body, err := sonic.Marshal(wire)
		return body, "application/json", err
	default:
		body := stripDropTuningParams(req.Body)
		if stream {
			body = ensureStreamIncludeUsage(body)
		}
		rewritten, err := sjson.SetBytes(body, "model", model)
		return rewritten, "application/json", err
	}
}

func azureTranscriptionBody(upload *domain.TranscriptionUpload, model string) ([]byte, string, error) {
	if upload == nil || len(upload.File) == 0 {
		return nil, "", fmt.Errorf("missing transcription upload")
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", upload.Filename)
	if err != nil {
		return nil, "", err
	}
	if _, err := part.Write(upload.File); err != nil {
		return nil, "", err
	}
	if err := writer.WriteField("model", model); err != nil {
		return nil, "", err
	}
	if err := writeAzureTranscriptionFields(writer, upload.Params); err != nil {
		return nil, "", err
	}
	if err := writer.Close(); err != nil {
		return nil, "", err
	}
	return body.Bytes(), writer.FormDataContentType(), nil
}

func writeAzureTranscriptionFields(writer *multipart.Writer, params map[string]string) error {
	for _, field := range []string{"language", "prompt", "response_format", "temperature"} {
		value := params[field]
		if value == "" {
			continue
		}
		if field == "temperature" {
			parsed, err := strconv.ParseFloat(value, 64)
			if err != nil {
				continue
			}
			value = strconv.FormatFloat(parsed, 'f', -1, 64)
		}
		if err := writer.WriteField(field, value); err != nil {
			return err
		}
	}

	return nil
}

func (r *BifrostRouter) dispatchAzureCompatibility(ctx context.Context, req *domain.Request, target azureCompatibilityTarget) (*domain.Response, error) {
	wire, err := azureCompatibilityRequest(req, target, false)
	if err != nil {
		return nil, azureCompatibilityError(ctx, err)
	}
	ctx = context.WithValue(ctx, azureAPIVersionAppliedKey{}, true)
	bfCtx := bfschemas.NewBifrostContext(withCredential(ctx, target.credential), time.Time{})
	resp, berr := r.bf.Passthrough(bfCtx, bfschemas.Azure, wire)
	if berr != nil {
		return nil, errFromBifrost(ctx, berr, bifrostResponseHeaders(bfCtx))
	}
	out, err := azureCompatibilityResponse(resp, req, target.model)
	if err != nil {
		return nil, herr.New(ctx, domain.ErrProviderError, herr.M{"reason": err.Error()})
	}
	return out, nil
}

func (r *BifrostRouter) dispatchAzureCompatibilityStream(ctx context.Context, req *domain.Request, target azureCompatibilityTarget) (domain.StreamIterator, error) {
	wire, err := azureCompatibilityRequest(req, target, true)
	if err != nil {
		return nil, azureCompatibilityError(ctx, err)
	}
	ctx = context.WithValue(ctx, azureAPIVersionAppliedKey{}, true)
	streamCtx, cancel := context.WithCancel(ctx)
	bfCtx := bfschemas.NewBifrostContext(withCredential(streamCtx, target.credential), time.Time{})
	ch, berr := r.bf.PassthroughStream(bfCtx, bfschemas.Azure, wire)
	if berr != nil {
		cancel()
		return nil, errFromBifrost(ctx, berr, bifrostResponseHeaders(bfCtx))
	}
	it := &azureChatIterator{ch: ch, cancel: cancel, model: target.model}
	if err := it.prepare(ctx); err != nil {
		cancel()
		return nil, err
	}
	return it, nil
}

func azureCompatibilityError(ctx context.Context, err error) error {
	code := domain.ErrBadRequest
	if errors.Is(err, errAzureDeploymentMissing) {
		code = domain.ErrProviderConfigInvalid
	}
	return herr.New(ctx, code, herr.M{"reason": err.Error()})
}

// A configured credential version took precedence over a passthrough client's query.
type azureAPIVersionAppliedKey struct{}

func applyAzurePassthroughVersion(req *bfschemas.BifrostPassthroughRequest, cred domain.Credential) bool {
	version := cred.Extra["api_version"]
	if strings.HasPrefix(req.Path, "/anthropic/") || strings.HasPrefix(req.Path, "/openai/videos") || strings.HasPrefix(req.Path, "/openai/v1/videos") {
		return false
	}
	if strings.Contains(req.Path, "openai/v1/responses") || strings.Contains(req.Path, "openai/responses") {
		return false
	}
	if version == "" {
		return false
	}
	query, err := url.ParseQuery(req.RawQuery)
	if err != nil {
		return false
	}
	query.Set("api-version", version)
	req.RawQuery = query.Encode()
	return true
}
