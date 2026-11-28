//go:build linux

package codeblock_test

import (
	"os"
	"testing"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/codeblock"
)

// TestMain points the other-process check at the tests' stand-in credential
// in this binary and every child it re-executes, so a machine whose shell
// exports AWS_* runs the suite the same as CI.
func TestMain(m *testing.M) {
	codeblock.LookOnlyForAmbientCredential(roleSecretEnv)
	os.Exit(m.Run())
}
