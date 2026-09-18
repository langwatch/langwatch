package ciscan_test

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/langwatch/langwatch/pkg/ciscan"
)

func TestConcurrencyCancelsInProgress(t *testing.T) {
	cases := []struct {
		name  string
		value any
		want  bool
	}{
		{"unquoted true", true, true},
		{"unquoted false", false, false},
		{"quoted true", "true", true},
		{"quoted mixed case", "TRUE", true},
		{"quoted false", "false", false},
		{"typo reads as not canceling", "ture", false},
		{"absent key", nil, false},
		{"unexpected type", 1, false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := ciscan.Concurrency{CancelInProgress: tc.value}.CancelsInProgress()

			assert.Equal(t, tc.want, got)
		})
	}
}
