//go:build dev

package main

import "testing"

const wantCombined = "aigateway,nlpgo,idpsim,mailsim,storagesim,voicesim,llmsim,analyticssim,telemetrysim,outboundsim,paymentsim,lambdasim,githubsim,mcpsim"

// @scenario "A dev build hosts the simulators in the combined process"
// @scenario "A dev build hosts paymentsim in the combined process"
func TestDevBuildHostsTheSimulators(t *testing.T) {
	for _, name := range []string{"idpsim", "mailsim", "storagesim", "voicesim", "llmsim", "analyticssim", "telemetrysim", "outboundsim", "paymentsim", "lambdasim", "githubsim", "mcpsim"} {
		if _, ok := services[name]; !ok {
			t.Errorf("a dev build does not dispatch %q on its own", name)
		}
		if _, err := selectCombinedServices([]string{name}); err != nil {
			t.Errorf("a dev build's combined process refuses %q: %v", name, err)
		}
	}
}

// @scenario "A dev build hosts mcpsim in the combined process"
func TestDevBuildHostsMcpsim(t *testing.T) {
	if _, ok := services["mcpsim"]; !ok {
		t.Error("a dev build does not run `service mcpsim`")
	}
	if _, err := selectCombinedServices([]string{"mcpsim"}); err != nil {
		t.Errorf("a dev build's combined process refuses mcpsim: %v", err)
	}
}
