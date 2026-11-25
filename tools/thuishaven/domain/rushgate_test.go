package domain

import "testing"

func TestUnderRushGate(t *testing.T) {
	cases := []struct {
		name string
		env  map[string]string
		want bool
	}{
		{"no rush", map[string]string{"NODE_OPTIONS": "--max-old-space-size=4096"}, false},
		{"gate held", map[string]string{RushGateHeldEnv: "1"}, true},
		{"gate preload", map[string]string{"NODE_OPTIONS": "--require /Users/x/.config/rush/gate/node/preload.cjs"}, true},
	}
	for _, c := range cases {
		if got := UnderRushGate(func(k string) string { return c.env[k] }); got != c.want {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
}
