package diffkit

import (
	"context"
	"fmt"
	"os/exec"

	"github.com/langwatch/langwatch/tools/havenrun"
)

// CheckSlug is the one shared stack every tool runs against: visualdiff boots
// it from the working tree, apidiff, the fuzzer and the simulator adopt it.
const CheckSlug = "visualdiff-check"

// SharedStack is the shared stack's addresses, read from `haven status`.
type SharedStack struct {
	Slug    string
	AppURL  string
	MailURL string
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
	return SharedStack{Slug: slug, AppURL: app, MailURL: mail}, nil
}
