package services_test

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/aigateway/dispatcher"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/channels"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/channels/gateway"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/channels/memory"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/services"
)

// llmFixtureCase is a recorded case plus the model calls langevals made for
// it, as testdata/record/FORMAT.md describes.
type llmFixtureCase struct {
	fixtureCase
	Env   map[string]string `json:"env"`
	Calls []recordedCall    `json:"calls"`
}

type recordedCall struct {
	Kind     string          `json:"kind"`
	Request  json.RawMessage `json:"request"`
	Response json.RawMessage `json:"response"`
	Status   int             `json:"status"`
}

type embeddingKey struct{ model, text string }

// recordedLLM is the gateway LLMChannel over an upstream that answers only
// what langevals was answered. The request compared is the one the gateway
// renders, so the replay proves the Go wire, not a second rendering of it.
type recordedLLM struct {
	channels.LLMChannel
	t          *testing.T
	url        string
	mu         sync.Mutex
	chats      []recordedCall
	chatUsed   []bool
	vectors    map[embeddingKey][]float64
	vectorUsed map[embeddingKey]bool
}

func newRecordedLLM(t *testing.T, calls []recordedCall) *recordedLLM {
	t.Helper()
	r := &recordedLLM{t: t, vectors: map[embeddingKey][]float64{}, vectorUsed: map[embeddingKey]bool{}}
	for _, call := range calls {
		switch call.Kind {
		case "chat":
			r.chats = append(r.chats, call)
		case "embedding":
			r.addEmbeddings(call)
		default:
			t.Fatalf("recorded call of unknown kind %q", call.Kind)
		}
	}
	r.chatUsed = make([]bool, len(r.chats))
	upstream := httptest.NewServer(http.HandlerFunc(r.serve))
	t.Cleanup(upstream.Close)
	r.url = upstream.URL
	disp, err := dispatcher.New(t.Context(), dispatcher.Options{})
	require.NoError(t, err)
	t.Cleanup(disp.Close)
	r.LLMChannel = gateway.New(gateway.Options{Dispatcher: disp})
	return r
}

// env is the tenant env the recording ran with, pointed at this upstream.
func (r *recordedLLM) env(extra map[string]string) map[string]string {
	env := map[string]string{
		"X_LITELLM_api_key":             "sk-recorded",
		"X_LITELLM_api_base":            r.url,
		"X_LITELLM_EMBEDDINGS_api_key":  "sk-recorded",
		"X_LITELLM_EMBEDDINGS_api_base": r.url,
	}
	for key, value := range extra {
		env[key] = value
	}
	return env
}

// addEmbeddings keys each recorded vector by model and input text: langevals
// embeds one text per call where the Go ports batch, so texts are the unit.
func (r *recordedLLM) addEmbeddings(call recordedCall) {
	var request struct {
		Model string          `json:"model"`
		Input json.RawMessage `json:"input"`
	}
	var response struct {
		Data []struct {
			Index     int       `json:"index"`
			Embedding []float64 `json:"embedding"`
		} `json:"data"`
	}
	require.NoError(r.t, json.Unmarshal(call.Request, &request))
	require.NoError(r.t, json.Unmarshal(call.Response, &response))
	texts := embeddingTexts(r.t, request.Input)
	for _, item := range response.Data {
		require.Less(r.t, item.Index, len(texts), "recorded embedding index")
		r.vectors[embeddingKey{request.Model, texts[item.Index]}] = item.Embedding
	}
}

func embeddingTexts(t *testing.T, input json.RawMessage) []string {
	var one string
	if json.Unmarshal(input, &one) == nil {
		return []string{one}
	}
	var many []string
	require.NoError(t, json.Unmarshal(input, &many), "embedding input: %s", input)
	return many
}

func (r *recordedLLM) serve(w http.ResponseWriter, req *http.Request) {
	body, err := io.ReadAll(req.Body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	var status int
	var answer []byte
	switch path := strings.TrimSuffix(req.URL.Path, "/"); {
	case strings.HasSuffix(path, "/chat/completions"):
		status, answer = r.answerChat(body)
	case strings.HasSuffix(path, "/embeddings"):
		status, answer = r.answerEmbeddings(body)
	default:
		r.t.Errorf("no recording serves %s %s", req.Method, req.URL.Path)
		status, answer = http.StatusNotFound, []byte(`{"error":{"message":"not recorded"}}`)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(answer)
}

// matchedChatFields are the request fields a replayed chat call must match.
func matchedChatFields() []string {
	return []string{"model", "messages", "tools", "tool_choice", "temperature", "top_p", "max_tokens", "n", "reasoning_effort"}
}

func (r *recordedLLM) answerChat(body []byte) (int, []byte) {
	got := decodeObject(r.t, body)
	r.mu.Lock()
	defer r.mu.Unlock()
	var nearest []string
	for i, call := range r.chats {
		if r.chatUsed[i] {
			continue
		}
		differing := differingFields(decodeObject(r.t, call.Request), got)
		if len(differing) == 0 {
			r.chatUsed[i] = true
			status := call.Status
			if status == 0 {
				status = http.StatusOK
			}
			return status, call.Response
		}
		if nearest == nil || len(differing) < len(nearest) {
			nearest = differing
		}
	}
	r.t.Errorf("no recorded chat call matches %s (nearest differs in %v)", body, nearest)
	return http.StatusInternalServerError, []byte(`{"error":{"message":"not recorded"}}`)
}

func differingFields(recorded, got map[string]any) []string {
	var differing []string
	for _, field := range matchedChatFields() {
		if !reflect.DeepEqual(chatField(recorded, field), chatField(got, field)) {
			differing = append(differing, field)
		}
	}
	return differing
}

// chatField reads a matched field; an absent n is litellm's and OpenAI's 1.
func chatField(body map[string]any, field string) any {
	value := body[field]
	if field == "n" && value == nil {
		return float64(1)
	}
	if field == "tools" {
		sortIntentEnum(value)
	}
	return value
}

// sortIntentEnum orders off_topic's intent enum: Python builds it from a set,
// so it compares as a set. The one relaxation, and only for that field.
func sortIntentEnum(tools any) {
	list, _ := tools.([]any)
	for _, tool := range list {
		object, _ := tool.(map[string]any)
		function, _ := object["function"].(map[string]any)
		if function["name"] != "identify_intent" {
			continue
		}
		parameters, _ := function["parameters"].(map[string]any)
		properties, _ := parameters["properties"].(map[string]any)
		intent, _ := properties["intent"].(map[string]any)
		enum, _ := intent["enum"].([]any)
		sort.Slice(enum, func(i, j int) bool { return fmt.Sprint(enum[i]) < fmt.Sprint(enum[j]) })
	}
}

func (r *recordedLLM) answerEmbeddings(body []byte) (int, []byte) {
	var request struct {
		Model string          `json:"model"`
		Input json.RawMessage `json:"input"`
	}
	require.NoError(r.t, json.Unmarshal(body, &request))
	type item struct {
		Object    string    `json:"object"`
		Index     int       `json:"index"`
		Embedding []float64 `json:"embedding"`
	}
	data := []item{}
	r.mu.Lock()
	defer r.mu.Unlock()
	for i, text := range embeddingTexts(r.t, request.Input) {
		key := embeddingKey{request.Model, text}
		vector, ok := r.vectors[key]
		if !ok {
			r.t.Errorf("no recorded embedding for model %q and text %q", request.Model, text)
			return http.StatusInternalServerError, []byte(`{"error":{"message":"not recorded"}}`)
		}
		r.vectorUsed[key] = true
		data = append(data, item{Object: "embedding", Index: i, Embedding: vector})
	}
	answer, err := json.Marshal(map[string]any{"object": "list", "model": request.Model, "data": data, "usage": map[string]int{"prompt_tokens": 0, "total_tokens": 0}})
	require.NoError(r.t, err)
	return http.StatusOK, answer
}

// assertAllCallsMade fails for every recorded call the replay never asked for.
func (r *recordedLLM) assertAllCallsMade(t *testing.T) {
	t.Helper()
	r.mu.Lock()
	defer r.mu.Unlock()
	for i, used := range r.chatUsed {
		assert.True(t, used, "recorded chat call %d was never made: %s", i, r.chats[i].Request)
	}
	for key := range r.vectors {
		assert.True(t, r.vectorUsed[key], "recorded embedding of %q with %s was never made", key.text, key.model)
	}
}

func decodeObject(t *testing.T, raw []byte) map[string]any {
	var object map[string]any
	require.NoError(t, json.Unmarshal(raw, &object), "request body: %s", raw)
	return object
}

// replayLLMFixtures is replayFixtures for evaluators that call models: each
// case runs against its own recording and must make exactly its calls.
func replayLLMFixtures(t *testing.T, slug, file string, opts replayOptions) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "testdata", "fixtures", file))
	require.NoError(t, err)
	var cases []llmFixtureCase
	require.NoError(t, json.Unmarshal(raw, &cases))
	require.NotEmpty(t, cases)

	for i := range cases {
		c := &cases[i]
		t.Run(c.Name, func(t *testing.T) {
			recording := newRecordedLLM(t, c.Calls)
			service := services.NewEvaluationService(services.EvaluationDeps{
				Config:        contract.DefaultConfig(),
				LLM:           recording,
				CustomerTrace: memory.NewCustomerTrace(),
				OpsTracer:     sdktrace.NewTracerProvider().Tracer("replay"),
				Logger:        zap.NewNop(),
				Evaluators:    services.BuiltinEvaluators(),
			})
			settings := c.Settings
			if len(settings) == 0 {
				settings = json.RawMessage(`{}`)
			}
			results, err := service.Evaluate(context.Background(), contract.EvaluateRequest{
				Tenant:    contract.Tenant{ProjectID: "project_replay", Env: recording.env(c.Env)},
				Evaluator: slug,
				Entries:   []contract.Entry{c.Entry},
				Settings:  settings,
			})
			require.NoError(t, err)
			require.Len(t, results, 1)
			compareResult(t, &c.fixtureCase, results[0], opts)
			recording.assertAllCallsMade(t)
		})
	}
}

// @scenario "Similarity and sentiment replay langevals' recorded embedding calls"
func TestReplaySimilarityAndSentimentAnswerFromRecordedEmbeddings(t *testing.T) {
	t.Run("similarity", func(t *testing.T) {
		replayLLMFixtures(t, "langevals/similarity", "langevals__similarity.json", replayOptions{Tolerance: 1e-9})
	})
	t.Run("sentiment", func(t *testing.T) {
		replayLLMFixtures(t, "langevals/sentiment", "langevals__sentiment.json", replayOptions{Tolerance: 1e-9})
	})
}

// A recorded judge call, sent as a Go judge would send it, is answered from
// the recording: the seam phase 3 builds on.
func TestRecordedLLMAnswersARecordedJudgeCall(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "testdata", "fixtures", "langevals__llm_boolean.json"))
	require.NoError(t, err)
	var cases []llmFixtureCase
	require.NoError(t, json.Unmarshal(raw, &cases))
	c := cases[0]
	require.Equal(t, "pass", c.Name)
	require.Len(t, c.Calls, 1)

	var recorded struct {
		Model      string             `json:"model"`
		Messages   []channels.Message `json:"messages"`
		Tools      []json.RawMessage  `json:"tools"`
		ToolChoice json.RawMessage    `json:"tool_choice"`
	}
	require.NoError(t, json.Unmarshal(c.Calls[0].Request, &recorded))
	recording := newRecordedLLM(t, c.Calls)
	resp, err := recording.Complete(t.Context(), channels.CompletionRequest{
		Tenant:     contract.Tenant{ProjectID: "project_replay", Env: recording.env(c.Env)},
		Model:      fmt.Sprintf("openai/%s", recorded.Model),
		Messages:   recorded.Messages,
		Tools:      recorded.Tools,
		ToolChoice: recorded.ToolChoice,
	})
	require.NoError(t, err)
	require.Len(t, resp.Choices, 1)
	require.Len(t, resp.Choices[0].ToolCalls, 1)
	assert.Equal(t, "evaluation", resp.Choices[0].ToolCalls[0].Name)
	recording.assertAllCallsMade(t)
}
