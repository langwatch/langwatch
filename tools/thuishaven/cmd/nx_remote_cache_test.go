package cmd

import "testing"

func TestShouldSetUpNxRemoteCache(t *testing.T) {
	for _, c := range []struct {
		name                   string
		isStub, isAgent, isTTY bool
		want                   bool
	}{
		{"a person at a terminal", false, false, true, true},
		{"an agent", false, true, false, true},
		{"the detached child of up -d", false, false, false, false},
		{"a stub run", true, false, true, false},
	} {
		if got := shouldSetUpNxRemoteCache(c.isStub, c.isAgent, c.isTTY); got != c.want {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
}
