package providers

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/aws/smithy-go"
	"github.com/tidwall/gjson"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// dispatchAgainstBedrockAnswering runs a Converse dispatch against a test
// server that answers every call with the given status and Bedrock exception.
func dispatchAgainstBedrockAnswering(t *testing.T, status int, exception, message string) error {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Amzn-ErrorType", exception)
		w.WriteHeader(status)
		_, _ = w.Write([]byte(`{"message":"` + message + `"}`))
	}))
	t.Cleanup(srv.Close)

	cred := domain.Credential{
		ID:         "cred-1",
		ProviderID: domain.ProviderBedrock,
		Extra: map[string]string{
			"bedrock_runtime_endpoint": srv.URL,
			"access_key":               "AKIAEXAMPLE",
			"secret_key":               "secretexample",
			"region":                   "eu-central-1",
		},
	}
	req := &domain.Request{
		Type:  domain.RequestTypeChat,
		Model: "global.openai.gpt-5.5",
		Body:  []byte(`{"messages":[{"role":"user","content":"hi"}]}`),
	}
	_, err := (&BifrostRouter{}).dispatchBedrockVPCE(
		context.Background(), req, mapProvider(cred), req.Model, cred, srv.URL,
	)
	if err == nil {
		t.Fatal("want an error from a refused Converse call")
	}
	return err
}

func TestWrapBedrockError(t *testing.T) {
	t.Run("when Bedrock refuses the request with a 400 ValidationException", func(t *testing.T) {
		/** @scenario "A Bedrock refusal reaches the client under its own status" */
		t.Run("the error is forwarded as a 400 naming the exception", func(t *testing.T) {
			err := dispatchAgainstBedrockAnswering(t, http.StatusBadRequest, "ValidationException",
				"Expected toolResult blocks at messages.2.content for the following Ids: call_b2")

			var ue *domain.UpstreamError
			if !errors.As(err, &ue) {
				t.Fatalf("want an UpstreamError, got %T: %v", err, err)
			}
			if ue.StatusCode != http.StatusBadRequest {
				t.Errorf("status: got %d, want 400", ue.StatusCode)
			}
			if ue.ErrorType != "ValidationException" || ue.ErrorCode != "ValidationException" {
				t.Errorf("type/code: got %q/%q, want ValidationException", ue.ErrorType, ue.ErrorCode)
			}
			if ue.Message != "Expected toolResult blocks at messages.2.content for the following Ids: call_b2" {
				t.Errorf("message: got %q", ue.Message)
			}
			if ue.Provider != string(domain.ProviderBedrock) {
				t.Errorf("provider: got %q", ue.Provider)
			}
		})
	})

	t.Run("when Bedrock refuses the credential with a 403", func(t *testing.T) {
		t.Run("the error is forwarded as a 403 naming AccessDeniedException", func(t *testing.T) {
			err := dispatchAgainstBedrockAnswering(t, http.StatusForbidden, "AccessDeniedException", "denied")

			var ue *domain.UpstreamError
			if !errors.As(err, &ue) {
				t.Fatalf("want an UpstreamError, got %T: %v", err, err)
			}
			if ue.StatusCode != http.StatusForbidden || ue.ErrorType != "AccessDeniedException" {
				t.Errorf("got %d %q, want 403 AccessDeniedException", ue.StatusCode, ue.ErrorType)
			}
		})
	})

	t.Run("when the SDK refuses to send a request missing a required field", func(t *testing.T) {
		/** @scenario "A request the SDK refuses to send is a bad request" */
		t.Run("it is a bad request, not a retryable provider error", func(t *testing.T) {
			err := wrapBedrockError(context.Background(), &smithy.InvalidParamsError{Context: "ConverseInput"})
			if !herr.IsCode(err, domain.ErrBadRequest) {
				t.Fatalf("want bad_request, got %v", err)
			}
		})
	})

	t.Run("when no answer came back", func(t *testing.T) {
		t.Run("it stays a retryable provider_error", func(t *testing.T) {
			err := wrapBedrockError(context.Background(), errors.New("dial tcp: connection refused"))
			if !herr.IsCode(err, domain.ErrProviderError) {
				t.Fatalf("want provider_error, got %v", err)
			}
		})
	})
}

func TestBedrockStreamError(t *testing.T) {
	t.Run("when the stream ends with a typed Bedrock exception", func(t *testing.T) {
		/** @scenario "A mid-stream Bedrock exception names its type and status" */
		t.Run("the exception name rides as the error type", func(t *testing.T) {
			err := bedrockStreamError(&smithy.GenericAPIError{
				Code:    "ThrottlingException",
				Message: "Too many tokens, please wait before trying again.",
			})
			var ue *domain.UpstreamError
			if !errors.As(err, &ue) {
				t.Fatalf("want an UpstreamError, got %T", err)
			}
			if ue.ErrorType != "ThrottlingException" || ue.Message != "Too many tokens, please wait before trying again." {
				t.Errorf("got %q %q", ue.ErrorType, ue.Message)
			}
			if ue.StatusCode != http.StatusTooManyRequests {
				t.Errorf("status: got %d, want 429 so the trace reads it as a rate limit", ue.StatusCode)
			}
		})
	})

	t.Run("when the Responses lane carries it to an Anthropic client", func(t *testing.T) {
		t.Run("the frame keeps the exception name and reads as a rate limit", func(t *testing.T) {
			berr := bedrockStreamBifrostError(bedrockStreamError(&smithy.GenericAPIError{
				Code:    "ThrottlingException",
				Message: "Too many tokens, please wait before trying again.",
			}))
			if berr.Error.Message != "ThrottlingException: Too many tokens, please wait before trying again." {
				t.Errorf("message: got %q", berr.Error.Message)
			}
			body := anthropicErrorFromBifrost(berr).Body
			if got := gjson.GetBytes(body, "error.type").String(); got != "rate_limit_error" {
				t.Errorf("anthropic error type: got %q, want rate_limit_error", got)
			}
		})
	})
}
