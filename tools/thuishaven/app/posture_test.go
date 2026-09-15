package app

import (
	"bytes"
	"context"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// @scenario "The tier can be pinned either way"
func TestResolveContainerPostureReadsWhatWasRecorded(t *testing.T) {
	t.Setenv(domain.PostureEnvVar, "")
	store := &fakeStore{containerPosture: "none"}
	// A machine that HAS colima, which the recorded answer overrides.
	tools := &fakeTools{binaries: map[string]bool{"colima": true, "docker": true}}
	o := installOrchestrator(tools, store, &fakeProxy{})

	got, err := o.ResolveContainerPosture(context.Background())
	if err != nil {
		t.Fatalf("ResolveContainerPosture: %v", err)
	}
	if got.Posture != domain.PostureNone {
		t.Errorf("posture = %v, want none — the developer said so", got.Posture)
	}
	if got.Source != domain.PostureRecorded {
		t.Errorf("source = %v, want recorded", got.Source)
	}
}

// @scenario "The tier can be pinned either way"
func TestAStatedPostureOverridesTheRecordedOneForOneRun(t *testing.T) {
	t.Setenv(domain.PostureEnvVar, "colima")
	store := &fakeStore{containerPosture: "none"}
	tools := &fakeTools{binaries: map[string]bool{"colima": true, "docker": true}}
	o := installOrchestrator(tools, store, &fakeProxy{})

	got, err := o.ResolveContainerPosture(context.Background())
	if err != nil {
		t.Fatalf("ResolveContainerPosture: %v", err)
	}
	if got.Posture != domain.PostureColima || got.Source != domain.PostureStated {
		t.Errorf("got %v (%v), want colima (stated)", got.Posture, got.Source)
	}
	// …for one run. It must not quietly rewrite what was recorded.
	if store.containerPosture != "none" {
		t.Errorf("recorded posture = %q, want it untouched", store.containerPosture)
	}
}

// colima needs the docker CLI too: it starts the VM, but every build and run
// afterwards is `docker`. Reporting colima as usable without it moves the
// failure to the first image build.
// @scenario "A machine with a container runtime keeps the bundled stack"
func TestColimaWithoutTheDockerCLIIsNotAColimaMachine(t *testing.T) {
	t.Setenv(domain.PostureEnvVar, "")
	tools := &fakeTools{binaries: map[string]bool{"colima": true}}
	o := installOrchestrator(tools, &fakeStore{}, &fakeProxy{})

	got, err := o.ResolveContainerPosture(context.Background())
	if err != nil {
		t.Fatalf("ResolveContainerPosture: %v", err)
	}
	if got.Posture != domain.PostureNone {
		t.Errorf("posture = %v, want none — colima alone is not a runtime haven can drive", got.Posture)
	}
}

// @scenario "The tier can be pinned either way"
func TestPinningARuntimeThisMachineLacksIsRefused(t *testing.T) {
	t.Setenv(domain.PostureEnvVar, "docker")
	o := installOrchestrator(&fakeTools{}, &fakeStore{}, &fakeProxy{})

	if _, err := o.ResolveContainerPosture(context.Background()); err == nil {
		t.Fatal("pinning docker on a machine with no docker must fail rather than fall back")
	}
}

// @scenario "A machine with no container runtime uses the native tier"
func TestRecordContainerPostureIsIdempotent(t *testing.T) {
	store := &fakeStore{}
	o := installOrchestrator(&fakeTools{}, store, &fakeProxy{})

	changed, err := o.RecordContainerPosture("none")
	if err != nil || !changed {
		t.Fatalf("first record: changed=%v err=%v", changed, err)
	}
	if store.containerPosture != "none" {
		t.Errorf("recorded %q, want none", store.containerPosture)
	}
	again, err := o.RecordContainerPosture("none")
	if err != nil || again {
		t.Errorf("second record: changed=%v err=%v; want no change", again, err)
	}
	if _, err := o.RecordContainerPosture("podman"); err == nil {
		t.Error("an unrecognised posture must be refused")
	}
}

// Answering "none" at the picker is a decision, and it has to stick in both
// senses: recorded as the machine's posture, and settled so the question
// stops being asked.
// @scenario "A machine with no container runtime uses the native tier"
func TestChoosingNoRuntimeRecordsItAndSettlesTheQuestion(t *testing.T) {
	store := &fakeStore{}
	tools := &fakeTools{}
	o := installOrchestrator(tools, store, &fakeProxy{})
	var out bytes.Buffer

	err := o.installPrereqsTo(context.Background(), &out, []domain.Chosen{{Key: "runtime", Candidate: "none"}})
	if err != nil {
		t.Fatalf("installPrereqs: %v", err)
	}
	if len(tools.ran) != 0 {
		t.Errorf("ran %v; choosing none installs nothing", tools.ran)
	}
	if store.containerPosture != "none" {
		t.Errorf("posture = %q, want none recorded", store.containerPosture)
	}
	if !o.PrereqSkips()["runtime"] {
		t.Error("a settled question must stop being asked")
	}
	if !strings.Contains(out.String(), "natively") {
		t.Errorf("the developer should be told what the choice means, got:\n%s", out.String())
	}
}

// Installing a runtime is also choosing it. Without this, a developer picks
// colima at the picker and haven is still guessing on the next run.
// @scenario "A machine with a container runtime keeps the bundled stack"
func TestInstallingARuntimeRecordsItAsTheChoice(t *testing.T) {
	store := &fakeStore{}
	o := installOrchestrator(&fakeTools{}, store, &fakeProxy{})

	err := o.installPrereqsTo(context.Background(), &bytes.Buffer{},
		[]domain.Chosen{{Key: "runtime", Candidate: "docker-desktop"}})
	if err != nil {
		t.Fatalf("installPrereqs: %v", err)
	}
	if store.containerPosture != "docker" {
		t.Errorf("posture = %q, want docker", store.containerPosture)
	}
}
