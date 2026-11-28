//go:build linux

package codeblock

import "slices"

// CarriesAmbientCredential exposes the environment-block check to the tests.
var CarriesAmbientCredential = carriesAmbientCredential

// AlsoTreatAsAmbientCredential adds a variable the other-process check looks for.
// A test whose stand-in process must be readable carries its credential under
// this name, so the test binaries running beside it never see a real one.
func AlsoTreatAsAmbientCredential(name string) {
	ambientCredentialVariables = append(slices.Clone(ambientCredentialVariables), name)
}
