package app

import (
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// The gate's own line above a tool call. It used to print "haven: admitted"
// above every gated command a session ran, which is the one decision that
// changed nothing about the run.
func TestTheGateIsSilentWhenItChangedNothing(t *testing.T) {
	t.Run("given a run the gate admitted unchanged", func(t *testing.T) {
		got := admissionMessage(rewrapRequest{decision: domain.Admit}, 0)
		if got != "" {
			t.Errorf("message = %q, want nothing - the command ran, which the caller can see", got)
		}
	})

	cases := []struct {
		name     string
		request  rewrapRequest
		workers  int
		contains []string
	}{
		{
			name:     "when the run was narrowed, it says to what",
			request:  rewrapRequest{decision: domain.Narrow},
			workers:  3,
			contains: []string{"narrowed", "3"},
		},
		{
			name:     "when the run queued, it says how many are ahead",
			request:  rewrapRequest{decision: domain.Queue, queueDepth: 2},
			contains: []string{"queued behind 2 runs"},
		},
		{
			name:     "when one run is ahead, it counts in the singular",
			request:  rewrapRequest{decision: domain.Queue, queueDepth: 1},
			contains: []string{"queued behind 1 run"},
		},
		{
			name:     "when the queue depth is unknown, it still says it queued",
			request:  rewrapRequest{decision: domain.Queue},
			contains: []string{"queued for the machine-wide slot"},
		},
		{
			name:     "when the run was backgrounded, it says where the result goes",
			request:  rewrapRequest{decision: domain.Background, queueDepth: 4},
			contains: []string{"backgrounded", "notification"},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := admissionMessage(tc.request, tc.workers)
			for _, want := range tc.contains {
				if !strings.Contains(got, want) {
					t.Errorf("message = %q, want it to mention %q", got, want)
				}
			}
		})
	}
}
