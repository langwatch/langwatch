package client

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// samplePromptJSON is a minimal-but-complete Prompt response body the API would
// return for a single prompt.
const samplePromptJSON = `{
	"id": "prompt_abc",
	"handle": "support-greeting",
	"scope": "PROJECT",
	"name": "Support greeting",
	"version": 3,
	"versionId": "prompt_version_xyz",
	"model": "openai/gpt-5-mini",
	"prompt": "You are friendly.",
	"messages": [{"role":"system","content":"You are friendly."}],
	"inputs": [{"identifier":"name","type":"str"}],
	"outputs": [{"identifier":"reply","type":"str"}],
	"temperature": 0.7,
	"maxTokens": 256,
	"tags": [{"name":"production","versionId":"prompt_version_xyz"}],
	"parameters": {"top_p": 0.9},
	"projectId": "project_1",
	"organizationId": "org_1",
	"createdAt": "2024-01-01T00:00:00Z",
	"updatedAt": "2024-01-02T00:00:00Z"
}`

func TestPromptsGet(t *testing.T) {
	t.Run("given an existing prompt", func(t *testing.T) {
		t.Run("when fetched by handle", func(t *testing.T) {
			var gotPath string
			var gotQuery string
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				gotPath = r.URL.Path
				gotQuery = r.URL.RawQuery
				assert.Equal(t, http.MethodGet, r.Method)
				_, _ = w.Write([]byte(samplePromptJSON))
			})

			p, err := c.Prompts.Get(context.Background(), "support-greeting", nil)
			require.NoError(t, err)

			assert.Equal(t, "/api/prompts/support-greeting", gotPath)
			assert.Empty(t, gotQuery)
			assert.Equal(t, "prompt_abc", p.ID)
			require.NotNil(t, p.Handle)
			assert.Equal(t, "support-greeting", *p.Handle)
			assert.Equal(t, PromptScopeProject, p.Scope)
			assert.Equal(t, 3, p.Version)
			assert.Equal(t, "openai/gpt-5-mini", p.Model)
			require.Len(t, p.Messages, 1)
			assert.Equal(t, RoleSystem, p.Messages[0].Role)
			require.NotNil(t, p.Temperature)
			assert.InDelta(t, 0.7, *p.Temperature, 0.0001)
			require.NotNil(t, p.MaxTokens)
			assert.Equal(t, 256, *p.MaxTokens)
			require.Len(t, p.Tags, 1)
			assert.Equal(t, "production", p.Tags[0].Name)
		})

		t.Run("when fetched with version and tag options", func(t *testing.T) {
			var gotQuery string
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				gotQuery = r.URL.Query().Encode()
				_, _ = w.Write([]byte(samplePromptJSON))
			})

			_, err := c.Prompts.Get(context.Background(), "support-greeting", &GetPromptOptions{
				Version: 4,
				Tag:     "production",
			})
			require.NoError(t, err)
			assert.Contains(t, gotQuery, "version=4")
			assert.Contains(t, gotQuery, "tag=production")
		})
	})

	t.Run("given a missing prompt", func(t *testing.T) {
		t.Run("when fetched", func(t *testing.T) {
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusNotFound)
				_, _ = w.Write([]byte(`{"error":"Prompt not found"}`))
			})

			p, err := c.Prompts.Get(context.Background(), "missing", nil)
			assert.Nil(t, p)
			require.Error(t, err)
			assert.True(t, IsNotFound(err))

			var apiErr *APIError
			require.ErrorAs(t, err, &apiErr)
			assert.Equal(t, http.StatusNotFound, apiErr.StatusCode)
			assert.Equal(t, "Prompt not found", apiErr.Message)
			assert.Equal(t, "Prompts.Get", apiErr.Operation)
		})
	})

	t.Run("given an unauthorized request", func(t *testing.T) {
		t.Run("when fetched", func(t *testing.T) {
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusUnauthorized)
				_, _ = w.Write([]byte(`{"message":"Invalid API key"}`))
			})

			_, err := c.Prompts.Get(context.Background(), "x", nil)
			require.Error(t, err)
			assert.True(t, IsUnauthorized(err))
		})
	})
}

func TestPromptsExists(t *testing.T) {
	t.Run("given a prompt that exists", func(t *testing.T) {
		c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
			_, _ = w.Write([]byte(samplePromptJSON))
		})
		ok, err := c.Prompts.Exists(context.Background(), "support-greeting")
		require.NoError(t, err)
		assert.True(t, ok)
	})

	t.Run("given a prompt that does not exist", func(t *testing.T) {
		c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusNotFound)
		})
		ok, err := c.Prompts.Exists(context.Background(), "missing")
		require.NoError(t, err, "404 maps to (false, nil), not an error")
		assert.False(t, ok)
	})

	t.Run("given a server error", func(t *testing.T) {
		c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusInternalServerError)
		}, WithMaxRetries(0))
		_, err := c.Prompts.Exists(context.Background(), "x")
		require.Error(t, err, "non-404 errors are surfaced")
	})
}

func TestPromptsCreate(t *testing.T) {
	t.Run("given valid params", func(t *testing.T) {
		t.Run("when creating", func(t *testing.T) {
			var gotBody map[string]any
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, http.MethodPost, r.Method)
				assert.Equal(t, "/api/prompts", r.URL.Path)
				assert.Equal(t, "application/json", r.Header.Get("Content-Type"))
				raw, _ := io.ReadAll(r.Body)
				require.NoError(t, json.Unmarshal(raw, &gotBody))
				_, _ = w.Write([]byte(samplePromptJSON))
			})

			p, err := c.Prompts.Create(context.Background(), CreatePromptParams{
				Handle: "support-greeting",
				Model:  "openai/gpt-5-mini",
				Messages: []Message{
					{Role: RoleSystem, Content: "You are friendly."},
				},
			})
			require.NoError(t, err)
			assert.Equal(t, "prompt_abc", p.ID)
			assert.Equal(t, "support-greeting", gotBody["handle"])
			assert.Equal(t, "openai/gpt-5-mini", gotBody["model"])
		})
	})

	t.Run("given a duplicate handle", func(t *testing.T) {
		t.Run("when creating", func(t *testing.T) {
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusConflict)
				_, _ = w.Write([]byte(`{"error":"Handle already exists"}`))
			})

			_, err := c.Prompts.Create(context.Background(), CreatePromptParams{Handle: "dup"})
			require.Error(t, err)
			assert.True(t, IsConflict(err))
		})
	})
}

func TestPromptsListAndVersions(t *testing.T) {
	t.Run("given prompts exist", func(t *testing.T) {
		t.Run("when listing", func(t *testing.T) {
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, "/api/prompts", r.URL.Path)
				_, _ = w.Write([]byte("[" + samplePromptJSON + "]"))
			})
			prompts, err := c.Prompts.List(context.Background())
			require.NoError(t, err)
			require.Len(t, prompts, 1)
			assert.Equal(t, "prompt_abc", prompts[0].ID)
		})
	})

	t.Run("given a prompt with versions", func(t *testing.T) {
		t.Run("when listing versions", func(t *testing.T) {
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, "/api/prompts/support-greeting/versions", r.URL.Path)
				_, _ = w.Write([]byte("[" + samplePromptJSON + "]"))
			})
			versions, err := c.Prompts.Versions(context.Background(), "support-greeting")
			require.NoError(t, err)
			require.Len(t, versions, 1)
		})
	})
}

func TestPromptsTags(t *testing.T) {
	t.Run("given the tags API", func(t *testing.T) {
		t.Run("when creating a tag", func(t *testing.T) {
			var gotBody map[string]any
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, http.MethodPost, r.Method)
				assert.Equal(t, "/api/prompts/tags", r.URL.Path)
				raw, _ := io.ReadAll(r.Body)
				_ = json.Unmarshal(raw, &gotBody)
				w.WriteHeader(http.StatusCreated)
				_, _ = w.Write([]byte(`{"id":"tag_1","name":"production","createdAt":"2024-01-01T00:00:00Z"}`))
			})
			tag, err := c.Prompts.CreateTag(context.Background(), "production")
			require.NoError(t, err)
			assert.Equal(t, "production", gotBody["name"])
			assert.Equal(t, "tag_1", tag.ID)
		})

		t.Run("when assigning a tag to a version", func(t *testing.T) {
			var gotBody map[string]any
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, http.MethodPut, r.Method)
				assert.Equal(t, "/api/prompts/support-greeting/tags/production", r.URL.Path)
				raw, _ := io.ReadAll(r.Body)
				_ = json.Unmarshal(raw, &gotBody)
				_, _ = w.Write([]byte(`{"configId":"prompt_abc","versionId":"prompt_version_xyz","tag":"production","updatedAt":"2024-01-01T00:00:00Z"}`))
			})
			res, err := c.Prompts.AssignTag(context.Background(), "support-greeting", "production", "prompt_version_xyz")
			require.NoError(t, err)
			assert.Equal(t, "prompt_version_xyz", gotBody["versionId"])
			assert.Equal(t, "production", res.Tag)
		})

		t.Run("when deleting a tag", func(t *testing.T) {
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, http.MethodDelete, r.Method)
				assert.Equal(t, "/api/prompts/tags/staging", r.URL.Path)
				w.WriteHeader(http.StatusNoContent)
			})
			err := c.Prompts.DeleteTag(context.Background(), "staging")
			require.NoError(t, err)
		})
	})
}
