package app

import (
	"context"
	"fmt"
	"os"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// Resolving the machine's container posture, and recording it when the
// developer states one.
//
// Everything container-shaped reads this: which observability tier runs,
// whether ClickHouse is a managed container or a native server, which langy
// worker tier is possible. One answer, so those three cannot disagree — which
// they could, and did, when each had its own environment variable.

// ContainerPosture is what this machine is set up to do, and where that
// answer came from.
type ContainerPosture struct {
	Posture domain.ContainerPosture
	Source  domain.PostureSource
}

// Line is the one line `up` prints when the posture shaped what it did.
func (p ContainerPosture) Line() string { return domain.PostureLine(p.Posture, p.Source) }

// ResolveContainerPosture applies the precedence — stated for this run, then
// recorded once, then what is installed — and refuses a stated posture whose
// runtime is not actually here. A detected posture is derived from the same
// facts, so it cannot contradict them and is never refused.
func (o *Orchestrator) ResolveContainerPosture(ctx context.Context) (ContainerPosture, error) {
	facts := o.postureFacts(ctx)
	posture, source, err := domain.ResolvePosture(facts)
	if err != nil {
		return ContainerPosture{}, err
	}
	if source != domain.PostureDetected {
		if err := domain.PostureUnavailable(posture, facts); err != nil {
			return ContainerPosture{}, err
		}
	}
	return ContainerPosture{Posture: posture, Source: source}, nil
}

func (o *Orchestrator) postureFacts(ctx context.Context) domain.PostureFacts {
	tools := o.prereqTools()
	docker := tools.BinaryPath("docker") != ""
	return domain.PostureFacts{
		Stated:   os.Getenv(domain.PostureEnvVar),
		Recorded: o.recordedPosture(),
		// colima is only a runtime haven can drive when the docker CLI is
		// there too: it starts the VM, but every image build and container
		// run afterwards is `docker`.
		ColimaInstalled: docker && tools.BinaryPath("colima") != "",
		DockerInstalled: docker,
	}
}

func (o *Orchestrator) recordedPosture() string {
	if o.store == nil {
		return ""
	}
	return o.store.ReadContainerPosture()
}

// RecordContainerPosture writes the developer's choice down, so it holds for
// every checkout on this machine and haven stops guessing. It reports whether
// anything changed, so a repeat reads as a no-op.
func (o *Orchestrator) RecordContainerPosture(choice string) (bool, error) {
	posture, ok := domain.ParsePosture(choice)
	if !ok || posture == domain.PostureUnset {
		return false, fmt.Errorf("%q is not a container posture — use one of: %s",
			choice, joinNames(domain.PostureChoices()))
	}
	if o.store == nil {
		return false, fmt.Errorf("no store is wired in")
	}
	if o.store.ReadContainerPosture() == posture.String() {
		return false, nil
	}
	return true, o.store.WriteContainerPosture(posture.String())
}

func joinNames(names []string) string {
	out := ""
	for i, n := range names {
		if i > 0 {
			out += ", "
		}
		out += n
	}
	return out
}
