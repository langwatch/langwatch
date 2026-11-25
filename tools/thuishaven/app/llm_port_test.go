package app

import (
	"testing"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

func TestStableLLMPort(t *testing.T) {
	t.Run("the same slug gets the same port across two provisions, registered or not", func(t *testing.T) {
		store := &fakeStore{}
		o := &Orchestrator{store: store, sys: &portSystem{}, log: zap.NewNop()}
		first := o.stableLLMPort("mine")
		if first < domain.LLMPortBase || first >= domain.LLMPortBase+domain.LLMPortSpan {
			t.Fatalf("port %d is outside the llmsim range", first)
		}
		if again := o.stableLLMPort("mine"); again != first {
			t.Fatalf("after teardown the port moved: %d then %d", first, again)
		}
		store.stacks = []domain.Stack{{Slug: "mine", Services: []domain.Service{{Name: domain.LLMService, Port: first}}}}
		if again := o.stableLLMPort("mine"); again != first {
			t.Fatalf("while registered the port moved: %d then %d", first, again)
		}
	})

	t.Run("a slug whose port another stack holds probes to a free one", func(t *testing.T) {
		o := &Orchestrator{store: &fakeStore{}, sys: &portSystem{}, log: zap.NewNop()}
		want := o.stableLLMPort("mine")
		o.store = &fakeStore{stacks: []domain.Stack{{Slug: "other", Services: []domain.Service{{Name: domain.LLMService, Port: want}}}}}
		if got := o.stableLLMPort("mine"); got == want || got == 0 {
			t.Fatalf("got %d, want a free port other than %d", got, want)
		}
	})
}
