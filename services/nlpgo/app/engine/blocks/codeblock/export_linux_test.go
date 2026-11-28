//go:build linux

package codeblock

import "github.com/langwatch/langwatch/pkg/cloudcredentials"

// CarriesAmbientCredential exposes the environment-block check, over the
// variables production looks for, to the tests.
func CarriesAmbientCredential(environ []byte) (string, bool) {
	return carriesAmbientCredential(environ, cloudcredentials.Names())
}

// LookOnlyForAmbientCredential replaces the variables the other-process check
// looks for. The tests look for their own stand-in only: a developer's shell
// that exports AWS_* is an ancestor of every test process and readable to it.
func LookOnlyForAmbientCredential(names ...string) {
	ambientCredentialVariables = names
}
