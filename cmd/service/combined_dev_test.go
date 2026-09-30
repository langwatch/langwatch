//go:build dev

package main

import "testing"

const wantCombined = "aigateway,nlpgo,idpsim,mailsim,storagesim,voicesim,llmsim"

// @scenario "A dev build hosts the simulators in the combined process"
func TestDevBuildHostsTheSimulators(t *testing.T) {
	for _, name := range []string{"idpsim", "mailsim", "storagesim", "voicesim", "llmsim"} {
		if _, ok := services[name]; !ok {
			t.Errorf("a dev build does not dispatch %q on its own", name)
		}
		if _, err := selectCombinedServices([]string{name}); err != nil {
			t.Errorf("a dev build's combined process refuses %q: %v", name, err)
		}
	}
}
