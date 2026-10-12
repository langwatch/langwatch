package cmd

import (
	"slices"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

func TestAgentBandArgvFollowsTheCapacity(t *testing.T) {
	agent := func(key string) string {
		if key == "CLAUDECODE" {
			return "1"
		}
		return ""
	}
	cases := []struct {
		band domain.RunBand
		want []string
	}{
		{domain.BandUtility, []string{"/usr/sbin/taskpolicy", "-c", "utility", "sh"}},
		{domain.BandBackground, []string{"/usr/bin/nice", "-n", "10", "sh"}},
		{domain.BandDefault, []string{"sh"}},
	}
	for _, c := range cases {
		if got := agentBandArgv(qosEnv{goos: "darwin", getenv: agent}, []string{"sh"}, c.band); !slices.Equal(got, c.want) {
			t.Fatalf("band %s: got %v, want %v", c.band, got, c.want)
		}
	}
	if got := agentBandArgv(qosEnv{goos: "darwin", getenv: func(string) string { return "" }}, []string{"sh"}, domain.BandBackground); !slices.Equal(got, []string{"sh"}) {
		t.Fatalf("a person's shell is never clamped, got %v", got)
	}
}
