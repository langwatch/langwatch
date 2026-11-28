// Package cloudcredentials names the environment variables a cloud platform
// puts a workload's own identity in. The code-block engine refuses to run code
// beside a readable process holding one, and the Lambda extension launcher
// starts the web adapter without them: one list, so the two never drift.
package cloudcredentials

import "slices"

// names is every variable a platform fills with the workload's credentials.
var names = []string{
	"AWS_ACCESS_KEY_ID",
	"AWS_SECRET_ACCESS_KEY",
	"AWS_SESSION_TOKEN",
	"AWS_CONTAINER_AUTHORIZATION_TOKEN",
	"AZURE_CLIENT_SECRET",
}

// Names returns the variables, as a copy the caller may change.
func Names() []string {
	return slices.Clone(names)
}

// IsAmbient reports whether name is one of the variables.
func IsAmbient(name string) bool {
	return slices.Contains(names, name)
}
