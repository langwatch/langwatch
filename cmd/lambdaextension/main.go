// Command lambdaextension starts the AWS Lambda Web Adapter without the
// function role's credentials. Lambda hands every extension those keys in its
// environment, which any process of the same user can read; the adapter only
// talks to the Lambda runtime and extensions APIs and never needs them. The
// image installs this binary readable at /opt/extensions/lambda-adapter (Lambda
// must read an extension to start it) and the real adapter execute-only at
// adapterPath. See specs/nlp-go/_shared/contract.md §7.
package main

import (
	"fmt"
	"os"
	"strings"
	"syscall"

	"github.com/langwatch/langwatch/pkg/cloudcredentials"
)

// adapterPath is the real adapter. Its file name stays lambda-adapter: the
// adapter registers under its own file name, which Lambda requires to match
// the extension's file in /opt/extensions.
const adapterPath = "/opt/lwa/lambda-adapter"

func main() {
	launch(adapterPath, os.Args, os.Environ())
	os.Exit(1)
}

// launch replaces this process with target, keeping argv, so the adapter runs
// as the extension's own process with environ minus the role's credentials.
// It returns only when the exec failed.
func launch(target string, argv, environ []string) {
	err := syscall.Exec(target, argv, withoutRoleCredentials(environ)) //nolint:gosec // a fixed path baked into the image
	fmt.Fprintf(os.Stderr, "lambdaextension: cannot start %s: %v\n", target, err)
}

// withoutRoleCredentials is environ minus every variable the code-block engine
// counts as a workload credential (pkg/cloudcredentials), the role's keys among them.
func withoutRoleCredentials(environ []string) []string {
	kept := make([]string, 0, len(environ))
	for _, kv := range environ {
		name, _, _ := strings.Cut(kv, "=")
		if !cloudcredentials.IsAmbient(name) {
			kept = append(kept, kv)
		}
	}
	return kept
}
