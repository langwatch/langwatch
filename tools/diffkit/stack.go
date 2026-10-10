package diffkit

import (
	"context"
	"fmt"
	"os"
	"os/exec"

	"github.com/langwatch/langwatch/tools/havenrun"
)

// CheckSlug is the one shared stack every tool runs against: visualdiff boots
// it from the working tree, apidiff, the fuzzer and the simulator adopt it.
const CheckSlug = "visualdiff-check"

// SharedStack is the shared stack's addresses, read from `haven status`.
// APIOrigin serves /api without the proxy: the backend lane's loopback port,
// or AppURL on a monolith (apidiff's -a and -b).
type SharedStack struct {
	Slug      string
	AppURL    string
	MailURL   string
	APIOrigin string
}

// APIURL is the REST base the tools call: the app URL with the /api mount.
func (stack SharedStack) APIURL() string { return stack.AppURL + "/api" }

// ReadSharedStack asks haven for the named stack's addresses once both Node
// lanes are listening. It never boots anything; visualdiff owns the boot.
func ReadSharedStack(ctx context.Context, slug string) (SharedStack, error) {
	if !havenrun.OnPath() {
		return SharedStack{}, fmt.Errorf("haven is not installed; pass -url")
	}
	out, err := exec.CommandContext(ctx, havenrun.Command, havenrun.StatusArgs()...).Output() // #nosec G204 -- fixed haven status args.
	if err != nil {
		return SharedStack{}, fmt.Errorf("haven status: %w", err)
	}
	status, err := havenrun.ParseStatus(out)
	if err != nil {
		return SharedStack{}, err
	}
	stack, ready := havenrun.StackReady(status, slug, havenrun.UILane, havenrun.BackendLane)
	if !ready {
		return SharedStack{}, fmt.Errorf("stack %s is not ready (both lanes listening)", slug)
	}
	app, ok := stack.ServiceURL(havenrun.AppService)
	if !ok {
		return SharedStack{}, fmt.Errorf("stack %s reports no app URL", slug)
	}
	mail, _ := stack.ServiceURL("mail")
	return SharedStack{Slug: slug, AppURL: app, MailURL: mail, APIOrigin: app}, nil
}

// The sides diffsuite hands every tool it starts, in DIFFSUITE_<side>_STACK,
// _URL, _API_URL and _MAIL_URL (tools/diffsuite/README.md). MAIN is set only
// when the suite has a main stack.
const (
	SuiteBranch = "BRANCH"
	SuiteMain   = "MAIN"
)

// SuiteEnv is the environment that hands stack to a tool as side.
func SuiteEnv(side string, stack SharedStack) []string {
	prefix := "DIFFSUITE_" + side + "_"
	return []string{prefix + "STACK=" + stack.Slug, prefix + "URL=" + stack.AppURL,
		prefix + "API_URL=" + stack.APIOrigin, prefix + "MAIL_URL=" + stack.MailURL}
}

// SuiteStack is the stack diffsuite handed this process as side, if it did.
func SuiteStack(side string) (SharedStack, bool) {
	prefix := "DIFFSUITE_" + side + "_"
	stack := SharedStack{Slug: os.Getenv(prefix + "STACK"), AppURL: os.Getenv(prefix + "URL"),
		APIOrigin: os.Getenv(prefix + "API_URL"), MailURL: os.Getenv(prefix + "MAIL_URL")}
	return stack, stack.AppURL != ""
}

// BranchStack is the branch stack diffsuite handed this process, else the shared check stack.
func BranchStack(ctx context.Context) (SharedStack, error) {
	if stack, ok := SuiteStack(SuiteBranch); ok {
		return stack, nil
	}
	return ReadSharedStack(ctx, CheckSlug)
}
