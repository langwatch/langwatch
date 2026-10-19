//go:build !dev

package main

import "testing"

const wantCombined = "aigateway,nlpgo"

// @scenario "A release build links no simulator"
func TestReleaseBuildOffersNoSimulator(t *testing.T) {
	for _, name := range []string{"idpsim", "mailsim", "storagesim", "voicesim", "llmsim"} {
		if _, ok := services[name]; ok {
			t.Errorf("an untagged build dispatches %q; the simulators belong to dev builds only", name)
		}
	}
}
