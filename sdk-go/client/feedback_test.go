package client

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"testing"

	langwatch "github.com/langwatch/langwatch/sdk-go"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestEventsTrack(t *testing.T) {
	t.Run("given a trace id captured from a span", func(t *testing.T) {
		t.Run("when tracking a custom event", func(t *testing.T) {
			var gotPath, gotMethod string
			var gotAuth, gotSdkVersion string
			var gotBody map[string]any
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				gotPath = r.URL.Path
				gotMethod = r.Method
				gotAuth = r.Header.Get("Authorization")
				gotSdkVersion = r.Header.Get("X-Langwatch-Sdk-Version")
				raw, _ := io.ReadAll(r.Body)
				_ = json.Unmarshal(raw, &gotBody)
				_, _ = w.Write([]byte(`{"message":"Event tracked"}`))
			})

			err := c.Events.Track(context.Background(), "trace_xyz", langwatch.Event{
				Type:    "selected_text",
				Metrics: map[string]float64{"text_length": 42},
				Details: map[string]string{"selected_text": "hello"},
			})
			require.NoError(t, err)

			// Maps to the canonical track-event endpoint.
			assert.Equal(t, http.MethodPost, gotMethod)
			assert.Equal(t, "/api/events/track", gotPath)

			// The body matches the server's track-event schema.
			assert.Equal(t, "trace_xyz", gotBody["trace_id"])
			assert.Equal(t, "selected_text", gotBody["event_type"])
			metrics, ok := gotBody["metrics"].(map[string]any)
			require.True(t, ok, "metrics present")
			assert.EqualValues(t, 42, metrics["text_length"])
			details, ok := gotBody["event_details"].(map[string]any)
			require.True(t, ok, "event_details present")
			assert.Equal(t, "hello", details["selected_text"])

			// Shared auth + SDK headers, same as every other call.
			assert.Equal(t, "Bearer sk-lw-test-key", gotAuth)
			assert.NotEmpty(t, gotSdkVersion)
		})

		t.Run("when the trace id is empty", func(t *testing.T) {
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				t.Fatalf("no request should be sent for an empty trace id")
			})
			err := c.Events.Track(context.Background(), "", langwatch.Event{Type: "thumbs_up_down"})
			require.Error(t, err)
		})

		t.Run("when the event type is empty", func(t *testing.T) {
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				t.Fatalf("no request should be sent for an empty event type")
			})
			err := c.Events.Track(context.Background(), "trace_xyz", langwatch.Event{})
			require.Error(t, err)
		})

		t.Run("when the API rejects the submission", func(t *testing.T) {
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusNotFound)
				_, _ = w.Write([]byte(`{"message":"trace not found"}`))
			})

			err := c.Events.Track(context.Background(), "trace_missing", langwatch.Event{
				Type:    "thumbs_up_down",
				Metrics: map[string]float64{"vote": 1},
			})
			require.Error(t, err)

			// Surfaces as a typed *APIError, branchable like every other method.
			assert.True(t, IsNotFound(err))
			var apiErr *APIError
			require.True(t, errors.As(err, &apiErr))
			assert.Equal(t, http.StatusNotFound, apiErr.StatusCode)
			assert.Equal(t, "Events.Track", apiErr.Operation)
			assert.Equal(t, "trace not found", apiErr.Message)
		})
	})
}

func TestFeedbackThumbs(t *testing.T) {
	t.Run("given a trace id captured from a span", func(t *testing.T) {
		t.Run("when recording a thumbs up with feedback", func(t *testing.T) {
			var gotPath, gotMethod string
			var gotAuth string
			var gotBody map[string]any
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				gotPath = r.URL.Path
				gotMethod = r.Method
				gotAuth = r.Header.Get("Authorization")
				raw, _ := io.ReadAll(r.Body)
				_ = json.Unmarshal(raw, &gotBody)
				_, _ = w.Write([]byte(`{"message":"Event tracked"}`))
			})

			err := c.Events.ThumbsUp(context.Background(), "trace_xyz", "spot on")
			require.NoError(t, err)

			// Thumbs feedback is a tracked event, not an annotation.
			assert.Equal(t, http.MethodPost, gotMethod)
			assert.Equal(t, "/api/events/track", gotPath)

			// The predefined thumbs_up_down event: vote=+1 and the feedback detail.
			assert.Equal(t, "trace_xyz", gotBody["trace_id"])
			assert.Equal(t, "thumbs_up_down", gotBody["event_type"])
			metrics := gotBody["metrics"].(map[string]any)
			assert.EqualValues(t, 1, metrics["vote"])
			details := gotBody["event_details"].(map[string]any)
			assert.Equal(t, "spot on", details["feedback"])

			// Auth flows on the convenience path exactly like every other call.
			assert.Equal(t, "Bearer sk-lw-test-key", gotAuth)
		})

		t.Run("when recording a thumbs down without feedback", func(t *testing.T) {
			var gotBody map[string]any
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				raw, _ := io.ReadAll(r.Body)
				_ = json.Unmarshal(raw, &gotBody)
				_, _ = w.Write([]byte(`{"message":"Event tracked"}`))
			})

			err := c.Events.ThumbsDown(context.Background(), "trace_xyz")
			require.NoError(t, err)

			assert.Equal(t, "thumbs_up_down", gotBody["event_type"])
			metrics := gotBody["metrics"].(map[string]any)
			assert.EqualValues(t, -1, metrics["vote"])
			// No event_details key when no feedback is supplied (omitempty).
			_, hasDetails := gotBody["event_details"]
			assert.False(t, hasDetails)
		})
	})
}
