package lanediff

import (
	"context"
	"flag"
	"fmt"
	"io"
	"strings"
)

// Run is the lane-diff CLI. It returns 0 when every base-only item is
// classified, 1 when some are not, 2 when the repository could not be read.
func Run(args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("lanediff", flag.ContinueOnError)
	flags.SetOutput(stderr)
	base := flags.String("base", "origin/main", "the ref the running workers were built from")
	head := flags.String("head", "HEAD", "the ref about to be deployed")
	root := flags.String("root", ".", "repository root")
	rulesPath := flags.String("rules", "", "classification file (JSON)")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	var classification Classification
	if *rulesPath != "" {
		var err error
		if classification, err = LoadClassification(*rulesPath); err != nil {
			fmt.Fprintln(stderr, err)
			return 2
		}
	}
	ctx := context.Background()
	refs := [2]Ref{{Name: *base}, {Name: *head}}
	var regs [2]Registry
	for i := range refs {
		sha, err := repo{ctx: ctx, root: *root}.git(nil, "rev-parse", "--short=10", refs[i].Name)
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 2
		}
		refs[i].Commit = strings.TrimSpace(string(sha))
		tree, err := ReadTree(ctx, *root, refs[i].Name)
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 2
		}
		regs[i] = Apply(Extract(tree), classification)
	}
	res := Diff(regs[0], regs[1], classification.Rules)
	Render(stdout, Report{Base: refs[0], Head: refs[1], BaseRegistry: regs[0], HeadRegistry: regs[1], Result: res})
	if res.Unclassified() > 0 {
		return 1
	}
	return 0
}

// Ref is a compared ref and the commit it resolved to.
type Ref struct {
	Name   string
	Commit string
}

// Unclassified counts base-only items no rule or drain classifies.
func (r Result) Unclassified() int {
	n := 0
	for _, group := range [][]Item{r.RemovedLanes, r.RemovedPipelines, r.RemovedProcesses, r.UnresolvedBase} {
		for _, item := range group {
			if item.Class == "UNCLASSIFIED" {
				n++
			}
		}
	}
	return n
}
