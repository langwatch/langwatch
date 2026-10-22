package llmsim

import (
	"encoding/json"
	"net/http"
	"slices"
	"strings"
	"testing"
)

const jevDecisionBody = `{"model":"mercury-decide","state":"the reply was polite","questions":{
	"polite":{"type":"noul","instructions":"Is it polite?"},
	"quality":{"type":"score","instructions":"Rate it","criteria":["1","2","3"]},
	"topic":{"type":"choice","instructions":"Topic?","criteria":{"billing":"money","support":"help"}}}}`

const openAIDecisionBody = `{"model":"gpt-6-luna","input":"the reply was polite","questions":[
	{"type":"predicate","name":"polite","instructions":"Is it polite?"},
	{"type":"score","name":"quality","instructions":"Rate it","levels":[{"label":"1"},{"label":"2"},{"label":"3"}]},
	{"type":"choice","name":"topic","instructions":"Topic?","choices":[{"value":"billing"},{"value":"support"}]}]}`

type jevDecision struct {
	Model   string `json:"model"`
	Answers map[string]struct {
		Type       string   `json:"type"`
		Noul       *float64 `json:"noul"`
		Choice     *string  `json:"choice"`
		Score      *int     `json:"score"`
		Confidence float64  `json:"confidence"`
	} `json:"answers"`
	Usage struct {
		InputTokens int `json:"input_tokens"`
	} `json:"usage"`
}

func put(t *testing.T, url, body string) {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), http.MethodPut, url, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("PUT %s answered %d", url, resp.StatusCode)
	}
}

func decode[T any](t *testing.T, body string) T {
	t.Helper()
	var v T
	if err := json.Unmarshal([]byte(body), &v); err != nil {
		t.Fatalf("answer %s does not decode: %v", body, err)
	}
	return v
}

func assertJevAnswers(t *testing.T, got jevDecision) {
	t.Helper()
	if got.Model != "mercury-decide" && got.Model != "clef" {
		t.Errorf("model = %q", got.Model)
	}
	if p := got.Answers["polite"].Noul; p == nil || *p < 0 || *p > 1 {
		t.Errorf("noul answer %+v is not a probability", got.Answers["polite"])
	}
	if s := got.Answers["quality"].Score; s == nil || *s < 0 || *s > 2 {
		t.Errorf("score answer %+v is not a level position", got.Answers["quality"])
	}
	if c := got.Answers["topic"].Choice; c == nil || (*c != "billing" && *c != "support") {
		t.Errorf("choice answer %+v names no offered option", got.Answers["topic"])
	}
	if got.Usage.InputTokens == 0 {
		t.Error("usage.input_tokens is zero")
	}
}

// @scenario "llmsim answers the Instant Evals decision calls"
func TestDecisionsAnswerTheJevWire(t *testing.T) {
	srv := newTestServer(t)
	for _, path := range []string{"/v1/decisions", "/v1/systemone"} {
		resp, body := post(t, srv.URL+path, jevDecisionBody, map[string]string{"Authorization": "Bearer sk-org-key-1234"})
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("%s answered %d: %s", path, resp.StatusCode, body)
		}
		assertJevAnswers(t, decode[jevDecision](t, body))
		_, again := post(t, srv.URL+path, jevDecisionBody, nil)
		if again != body {
			t.Errorf("%s answered the same call differently:\n%s\n%s", path, body, again)
		}
	}
}

// @scenario "llmsim answers the Instant Evals decision calls"
func TestDecisionsAnswerTheOpenAIWireByName(t *testing.T) {
	srv := newTestServer(t)
	resp, body := post(t, srv.URL+"/v1/decisions", openAIDecisionBody, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("answered %d: %s", resp.StatusCode, body)
	}
	got := decode[struct {
		Answers []struct {
			Type        string          `json:"type"`
			Name        string          `json:"name"`
			Probability *float64        `json:"probability"`
			Score       *int            `json:"score"`
			Choice      json.RawMessage `json:"choice"`
		} `json:"answers"`
	}](t, body)
	names := make([]string, 0, len(got.Answers))
	for _, a := range got.Answers {
		names = append(names, a.Name)
	}
	if !slices.Equal(names, []string{"polite", "quality", "topic"}) {
		t.Fatalf("answers name %v", names)
	}
	if p := got.Answers[0].Probability; p == nil || *p < 0 || *p > 1 {
		t.Errorf("predicate answer %+v has no probability", got.Answers[0])
	}
	if s := got.Answers[1].Score; s == nil || *s < 0 || *s > 2 {
		t.Errorf("score answer %+v is not a level position", got.Answers[1])
	}
	if c := string(got.Answers[2].Choice); c != `"billing"` && c != `"support"` {
		t.Errorf("choice answer %s names no offered value", c)
	}
}

// @scenario "llmsim answers the Instant Evals decision calls"
func TestDecisionsWrapCloudflareInItsResultEnvelope(t *testing.T) {
	srv := newTestServer(t)
	resp, body := post(t, srv.URL+"/client/v4/accounts/acc-1/ai/run/@cf/cloudflare/clef",
		strings.Replace(jevDecisionBody, "mercury-decide", "clef", 1), nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("answered %d: %s", resp.StatusCode, body)
	}
	got := decode[struct {
		Result  json.RawMessage `json:"result"`
		Success bool            `json:"success"`
	}](t, body)
	if !got.Success {
		t.Error("success is false")
	}
	assertJevAnswers(t, decode[jevDecision](t, string(got.Result)))
}

// @scenario "llmsim answers the Instant Evals decision calls"
func TestDecisionsAnswerAQueuedJSONVerbatimOnce(t *testing.T) {
	srv := newTestServer(t)
	pinned := `{"answers":{"polite":{"type":"noul","noul":0.01}}}`
	put(t, srv.URL+"/_sim/api/settings", `{"nextJson":`+pinned+`}`)
	_, body := post(t, srv.URL+"/client/v4/accounts/acc-1/ai/run/@cf/cloudflare/clef", jevDecisionBody, nil)
	got := decode[struct {
		Result json.RawMessage `json:"result"`
	}](t, body)
	if string(got.Result) != pinned {
		t.Errorf("result = %s, want the queued %s", got.Result, pinned)
	}
	_, next := post(t, srv.URL+"/v1/decisions", jevDecisionBody, nil)
	if strings.Contains(next, "0.01") {
		t.Errorf("the queued answer was used twice: %s", next)
	}
}

// @scenario "llmsim answers the Instant Evals decision calls"
func TestDecisionsRecordTheWireAndAMaskedKey(t *testing.T) {
	srv := newTestServer(t)
	post(t, srv.URL+"/v1/decisions", openAIDecisionBody, map[string]string{"Authorization": "Bearer sk-org-key-1234"})
	post(t, srv.URL+"/v1/decisions", jevDecisionBody, nil)
	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, srv.URL+"/_sim/api/calls", nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	var listed struct {
		Calls []record `json:"calls"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&listed); err != nil {
		t.Fatal(err)
	}
	if len(listed.Calls) != 2 {
		t.Fatalf("recorded %d calls", len(listed.Calls))
	}
	jev, openai := listed.Calls[0], listed.Calls[1]
	if jev.Dialect != dialectDecisions || jev.Mode != wireJev || jev.Auth != "none" {
		t.Errorf("jev call recorded as %+v", jev)
	}
	if openai.Mode != wireOpenAIDecisions || openai.Model != "gpt-6-luna" || openai.Auth != "Bearer ...1234" {
		t.Errorf("openai call recorded as %+v", openai)
	}
	if strings.Contains(openai.Auth, "sk-org") {
		t.Errorf("the recorded auth %q keeps the key", openai.Auth)
	}
}

// @scenario "llmsim answers the Instant Evals decision calls"
func TestDecisionsTakeForcedErrorsWithRetryAfterOnARateLimit(t *testing.T) {
	srv := newTestServer(t)
	resp, _ := post(t, srv.URL+"/v1/decisions", jevDecisionBody, map[string]string{HeaderError: "429"})
	if resp.StatusCode != http.StatusTooManyRequests || resp.Header.Get("Retry-After") == "" {
		t.Errorf("a forced 429 answered %d with Retry-After %q", resp.StatusCode, resp.Header.Get("Retry-After"))
	}
	put(t, srv.URL+"/_sim/api/settings", `{"forcedError":401}`)
	resp, _ = post(t, srv.URL+"/client/v4/accounts/acc-1/ai/run/@cf/cloudflare/clef", jevDecisionBody, nil)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("the console's forced 401 answered %d", resp.StatusCode)
	}
}

func TestDecisionsRefuseABodyWithoutQuestions(t *testing.T) {
	srv := newTestServer(t)
	resp, _ := post(t, srv.URL+"/v1/decisions", `{"model":"m","state":"x"}`, nil)
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("answered %d, want 400", resp.StatusCode)
	}
}
