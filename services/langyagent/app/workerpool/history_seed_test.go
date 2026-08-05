package workerpool

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/langwatch/langwatch/services/langyagent/app"
)

// seedRecordingAgent is a minimal app.CodingAgent that records every Post's
// turn and fails on demand, so the seed-once gate can be exercised without an
// opencode process.
type seedRecordingAgent struct {
	posts   []app.Turn
	postErr error
}

func (a *seedRecordingAgent) WaitReady(context.Context, app.Endpoint) error { return nil }
func (a *seedRecordingAgent) OpenSession(context.Context, app.Endpoint) (string, error) {
	return "sess", nil
}
func (a *seedRecordingAgent) Post(_ context.Context, _ app.Endpoint, _ string, turn app.Turn) error {
	a.posts = append(a.posts, turn)
	return a.postErr
}
func (a *seedRecordingAgent) Stream(context.Context, app.Endpoint, string, app.ChatSink) error {
	return nil
}
func (a *seedRecordingAgent) NotifyShutdownImminent(context.Context, app.Endpoint, string, time.Time) error {
	return nil
}

func newSeedWorker(agent app.CodingAgent) *Worker {
	return &Worker{
		conversationID:    "conv-1",
		agent:             agent,
		endpoint:          app.Endpoint{BaseURL: "http://127.0.0.1:0", BearerToken: "b"},
		openCodeSessionID: "sess",
	}
}

// The seed is folded in ahead of the prompt on the session's FIRST delivered
// message, and never again: later turns of the same session post their prompt
// bare, because the session's own transcript already carries the seed and a
// byte-stable request prefix is what keeps provider prompt caching reading
// instead of re-writing.
func TestPostMessage_SeedsFirstDeliveredMessageOnly(t *testing.T) {
	agent := &seedRecordingAgent{}
	w := newSeedWorker(agent)
	seed := "THE CONVERSATION SO FAR: earlier things were said"

	if err := w.PostMessage(context.Background(), "sys", "what is my name?", seed, ""); err != nil {
		t.Fatalf("first PostMessage: %v", err)
	}
	if err := w.PostMessage(context.Background(), "sys", "and my surname?", seed, ""); err != nil {
		t.Fatalf("second PostMessage: %v", err)
	}

	if len(agent.posts) != 2 {
		t.Fatalf("posts = %d, want 2", len(agent.posts))
	}
	first, second := agent.posts[0], agent.posts[1]
	if !strings.HasPrefix(first.Prompt, seed+"\n\n") {
		t.Fatalf("first prompt does not start with the seed: %q", first.Prompt)
	}
	if !strings.HasSuffix(first.Prompt, "what is my name?") {
		t.Fatalf("first prompt does not end with the ask: %q", first.Prompt)
	}
	if second.Prompt != "and my surname?" {
		t.Fatalf("second prompt re-carried the seed: %q", second.Prompt)
	}
}

// A post that FAILED delivered nothing, so the retry must seed again — the
// flag flips only on a successful post.
func TestPostMessage_FailedFirstPostSeedsAgainOnRetry(t *testing.T) {
	agent := &seedRecordingAgent{postErr: errors.New("boom")}
	w := newSeedWorker(agent)
	seed := "THE CONVERSATION SO FAR: earlier things were said"

	if err := w.PostMessage(context.Background(), "sys", "hello?", seed, ""); err == nil {
		t.Fatal("first PostMessage should have failed")
	}
	agent.postErr = nil
	if err := w.PostMessage(context.Background(), "sys", "hello again?", seed, ""); err != nil {
		t.Fatalf("retry PostMessage: %v", err)
	}

	retry := agent.posts[len(agent.posts)-1]
	if !strings.HasPrefix(retry.Prompt, seed+"\n\n") {
		t.Fatalf("retry after failed delivery lost the seed: %q", retry.Prompt)
	}
}

// An empty seed (a brand-new conversation) leaves the prompt untouched.
func TestPostMessage_EmptySeedLeavesPromptBare(t *testing.T) {
	agent := &seedRecordingAgent{}
	w := newSeedWorker(agent)

	if err := w.PostMessage(context.Background(), "sys", "hi", "", ""); err != nil {
		t.Fatalf("PostMessage: %v", err)
	}
	if agent.posts[0].Prompt != "hi" {
		t.Fatalf("prompt = %q, want bare ask", agent.posts[0].Prompt)
	}
}
