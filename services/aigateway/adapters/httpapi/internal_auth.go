package httpapi

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Inbound HMAC headers used by internal callers (today: services/nlpgo)
// that hold per-request customer provider credentials. The headers carry
// inline credentials directly, so we do not consult control plane / VK auth.
const (
	HeaderInternalAuth         = "X-LangWatch-Internal-Auth"
	HeaderInternalTimestamp    = "X-LangWatch-Internal-Timestamp"
	HeaderInlineCredentials    = "X-LangWatch-Inline-Credentials"
	HeaderInternalProjectID    = "X-LangWatch-Project-Id"
	internalAuthMaxSkewSeconds = 300
	internalAuthFutureSkew     = 60
)

// InternalAuthMiddleware accepts requests signed with the gateway's shared
// internal secret + an inline-credentials header, and short-circuits the
// standard VK auth path for those requests. See _shared/contract.md §8.1.
//
// On absence of the X-LangWatch-Internal-Auth header the middleware is a
// no-op and the request falls through to the next handler (AuthMiddleware).
// On presence the middleware fully decides the auth outcome — a present-
// but-invalid header always returns 401 (no silent fall-through to VK auth).
//
// secret is the shared LW_GATEWAY_INTERNAL_SECRET. maxBodyBytes caps the
// body we will read into memory for HMAC verification; requests exceeding
// it are rejected with 413 before any provider dispatch.
func InternalAuthMiddleware(secret string, maxBodyBytes int64) func(http.Handler) http.Handler {
	secretBytes := []byte(secret)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get(HeaderInternalAuth) == "" {
				next.ServeHTTP(w, r)
				return
			}
			if len(secretBytes) == 0 {
				clog.Get(r.Context()).Warn("internal_auth_disabled_secret_unset")
				herr.WriteHTTP(w, herr.New(r.Context(), domain.ErrInvalidAPIKey, herr.M{
					"message": "internal auth not configured on this gateway",
				}))
				return
			}

			bundle, err := verifyInternalAuth(r, secretBytes, maxBodyBytes)
			if err != nil {
				clog.Get(r.Context()).Warn("internal_auth_failed", zap.Error(err))
				herr.WriteHTTP(w, herr.New(r.Context(), domain.ErrInvalidAPIKey, herr.M{
					"message": "internal auth failed",
				}))
				return
			}

			ctx := context.WithValue(r.Context(), bundleCtxKey{}, bundle)
			ctx = clog.With(ctx,
				zap.String("project_id", bundle.ProjectID),
				zap.String("auth_mode", "internal_inline"),
			)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func verifyInternalAuth(r *http.Request, secret []byte, maxBodyBytes int64) (*domain.Bundle, error) {
	tsStr := r.Header.Get(HeaderInternalTimestamp)
	if tsStr == "" {
		return nil, errors.New("missing timestamp header")
	}
	ts, err := strconv.ParseInt(tsStr, 10, 64)
	if err != nil {
		return nil, errors.New("invalid timestamp")
	}
	now := time.Now().Unix()
	if ts < now-internalAuthMaxSkewSeconds || ts > now+internalAuthFutureSkew {
		return nil, errors.New("timestamp outside allowed skew")
	}

	credsHeader := r.Header.Get(HeaderInlineCredentials)
	if credsHeader == "" {
		return nil, errors.New("missing inline credentials header")
	}

	body, err := readAllCapped(r.Body, maxBodyBytes)
	if err != nil {
		return nil, err
	}
	r.Body = io.NopCloser(bytes.NewReader(body))
	r.ContentLength = int64(len(body))

	expected := computeInternalSignature(secret, r.Method, r.URL.Path, tsStr, body, credsHeader)
	provided := r.Header.Get(HeaderInternalAuth)
	if !hmac.Equal([]byte(provided), []byte(expected)) {
		return nil, errors.New("signature mismatch")
	}

	cred, err := parseInlineCredentials(credsHeader)
	if err != nil {
		return nil, err
	}

	projectID := r.Header.Get(HeaderInternalProjectID)
	if projectID == "" {
		return nil, errors.New("missing project id header")
	}

	return &domain.Bundle{
		ProjectID:   projectID,
		Credentials: []domain.Credential{cred},
	}, nil
}

// computeInternalSignature mirrors controlplane.Signer's canonical layout
// extended with the inline-credentials header hash. Signing the credentials
// blob into the canonical input means a successful HMAC implies the inline
// creds were not tampered in flight.
//
//	METHOD\nPATH\nTIMESTAMP\nhex(sha256(BODY))\nhex(sha256(INLINE_CREDS_HEADER))
func computeInternalSignature(secret []byte, method, path, ts string, body []byte, credsHeader string) string {
	bodyHash := sha256.Sum256(body)
	credsHash := sha256.Sum256([]byte(credsHeader))

	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(method))
	mac.Write([]byte{'\n'})
	mac.Write([]byte(path))
	mac.Write([]byte{'\n'})
	mac.Write([]byte(ts))
	mac.Write([]byte{'\n'})
	mac.Write([]byte(hex.EncodeToString(bodyHash[:])))
	mac.Write([]byte{'\n'})
	mac.Write([]byte(hex.EncodeToString(credsHash[:])))

	return hex.EncodeToString(mac.Sum(nil))
}

// inlineCredentials is the JSON shape carried in the X-LangWatch-Inline-
// Credentials header. Only the slot for the active provider is populated.
// The translator in services/nlpgo/adapters/litellm/ produces this shape
// from a workflow node's litellm_params.
type inlineCredentials struct {
	Provider  string                 `json:"provider"`
	OpenAI    map[string]string      `json:"openai,omitempty"`
	Anthropic map[string]string      `json:"anthropic,omitempty"`
	Azure     map[string]any         `json:"azure,omitempty"`
	Bedrock   map[string]string      `json:"bedrock,omitempty"`
	VertexAI  map[string]string      `json:"vertex_ai,omitempty"`
	Gemini    map[string]string      `json:"gemini,omitempty"`
	Custom    map[string]string      `json:"custom,omitempty"`
	Extras    map[string]any         `json:"-"`
}

func parseInlineCredentials(header string) (domain.Credential, error) {
	raw, err := base64.StdEncoding.DecodeString(header)
	if err != nil {
		// Allow URL-safe variant too — callers building headers via JS or
		// shell pipelines often default to URL-safe base64.
		raw, err = base64.URLEncoding.DecodeString(header)
		if err != nil {
			return domain.Credential{}, errors.New("inline credentials base64 decode")
		}
	}
	var ic inlineCredentials
	if err := json.Unmarshal(raw, &ic); err != nil {
		return domain.Credential{}, errors.New("inline credentials json decode")
	}
	return inlineCredentialsToDomain(ic)
}

func inlineCredentialsToDomain(ic inlineCredentials) (domain.Credential, error) {
	switch ic.Provider {
	case "openai":
		return domain.Credential{
			ID:         "inline_openai",
			ProviderID: domain.ProviderOpenAI,
			APIKey:     ic.OpenAI["api_key"],
			Extra:      stringMap(ic.OpenAI, "api_key"),
		}, nil
	case "anthropic":
		return domain.Credential{
			ID:         "inline_anthropic",
			ProviderID: domain.ProviderAnthropic,
			APIKey:     ic.Anthropic["api_key"],
			Extra:      stringMap(ic.Anthropic, "api_key"),
		}, nil
	case "azure":
		key, _ := ic.Azure["api_key"].(string)
		return domain.Credential{
			ID:         "inline_azure",
			ProviderID: domain.ProviderAzure,
			APIKey:     key,
			Extra:      flattenAnyMap(ic.Azure, "api_key"),
		}, nil
	case "bedrock":
		return domain.Credential{
			ID:         "inline_bedrock",
			ProviderID: domain.ProviderBedrock,
			APIKey:     "", // Bedrock authenticates via AWS keys in Extra
			Extra:      cloneStringMap(ic.Bedrock),
		}, nil
	case "vertex_ai", "vertex":
		return domain.Credential{
			ID:         "inline_vertex",
			ProviderID: domain.ProviderVertex,
			APIKey:     "", // Vertex authenticates via SA JSON in Extra
			Extra:      cloneStringMap(ic.VertexAI),
		}, nil
	case "gemini":
		return domain.Credential{
			ID:         "inline_gemini",
			ProviderID: domain.ProviderGemini,
			APIKey:     ic.Gemini["api_key"],
			Extra:      stringMap(ic.Gemini, "api_key"),
		}, nil
	case "custom":
		// Custom OpenAI-compatible providers (Together, Groq, Mistral) are
		// treated as openai with a custom api_base. The translator on the
		// nlpgo side already rewrites the model id from "custom/..." to
		// "openai/..." before sending — see _shared/contract.md §9.
		return domain.Credential{
			ID:         "inline_custom",
			ProviderID: domain.ProviderOpenAI,
			APIKey:     ic.Custom["api_key"],
			Extra:      stringMap(ic.Custom, "api_key"),
		}, nil
	default:
		return domain.Credential{}, errors.New("unknown provider in inline credentials")
	}
}

func stringMap(in map[string]string, omit ...string) map[string]string {
	out := make(map[string]string, len(in))
	skip := make(map[string]struct{}, len(omit))
	for _, k := range omit {
		skip[k] = struct{}{}
	}
	for k, v := range in {
		if _, drop := skip[k]; drop {
			continue
		}
		out[k] = v
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func cloneStringMap(in map[string]string) map[string]string {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string]string, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

// flattenAnyMap turns the Azure map[string]any into map[string]string. JSON
// objects under keys like extra_headers are re-marshaled back to a JSON
// string so the provider adapter can decode them later.
func flattenAnyMap(in map[string]any, omit ...string) map[string]string {
	out := make(map[string]string, len(in))
	skip := make(map[string]struct{}, len(omit))
	for _, k := range omit {
		skip[k] = struct{}{}
	}
	for k, v := range in {
		if _, drop := skip[k]; drop {
			continue
		}
		switch t := v.(type) {
		case string:
			out[k] = t
		case nil:
			// drop
		default:
			b, err := json.Marshal(t)
			if err != nil {
				continue
			}
			out[k] = string(b)
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// readAllCapped reads up to maxBytes from r, returning an error if the
// reader has more bytes available. maxBytes <= 0 disables the cap.
func readAllCapped(r io.Reader, maxBytes int64) ([]byte, error) {
	if r == nil {
		return nil, nil
	}
	if maxBytes <= 0 {
		return io.ReadAll(r)
	}
	limited := io.LimitReader(r, maxBytes+1)
	body, err := io.ReadAll(limited)
	if err != nil {
		return nil, err
	}
	if int64(len(body)) > maxBytes {
		return nil, errors.New("request body exceeds max size")
	}
	return body, nil
}
