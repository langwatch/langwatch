package domain

import (
	"strings"
	"testing"
)

// @scenario "The tier can be pinned either way"
func TestStatedPostureWinsOverEverything(t *testing.T) {
	got, source, err := ResolvePosture(PostureFacts{
		Stated: "native", Recorded: "colima", ColimaInstalled: true, DockerInstalled: true,
	})
	if err != nil {
		t.Fatalf("ResolvePosture: %v", err)
	}
	if got != PostureNone {
		t.Errorf("posture = %v, want none — what was said for this run wins", got)
	}
	if source != PostureStated {
		t.Errorf("source = %v, want stated", source)
	}
}

// @scenario "A machine with no container runtime uses the native tier"
func TestRecordedPostureWinsOverWhatIsInstalled(t *testing.T) {
	got, source, err := ResolvePosture(PostureFacts{
		Recorded: "none", ColimaInstalled: true, DockerInstalled: true,
	})
	if err != nil {
		t.Fatalf("ResolvePosture: %v", err)
	}
	if got != PostureNone {
		t.Errorf("posture = %v, want none — having colima installed is not asking haven to use it", got)
	}
	if source != PostureRecorded {
		t.Errorf("source = %v, want recorded", source)
	}
}

// @scenario "A machine with a container runtime keeps the bundled stack"
func TestDetectionPrefersColimaThenDockerThenNone(t *testing.T) {
	for _, tc := range []struct {
		name           string
		colima, docker bool
		want           ContainerPosture
	}{
		// colima first where both exist: it is the one haven sizes, caps and
		// can start itself.
		{"both installed", true, true, PostureColima},
		{"only docker", false, true, PostureDocker},
		{"neither", false, false, PostureNone},
	} {
		got, source, err := ResolvePosture(PostureFacts{ColimaInstalled: tc.colima, DockerInstalled: tc.docker})
		if err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
		if got != tc.want {
			t.Errorf("%s: posture = %v, want %v", tc.name, got, tc.want)
		}
		if source != PostureDetected {
			t.Errorf("%s: source = %v, want detected", tc.name, source)
		}
	}
}

// Nothing installed is an answer, not a failure: every tier has a native or
// disabled form, so a bare machine is a workable one.
// @scenario "A machine with no container runtime uses the native tier"
func TestABareMachineResolvesToNoneWithoutError(t *testing.T) {
	if _, _, err := ResolvePosture(PostureFacts{}); err != nil {
		t.Errorf("a machine with no runtime must resolve, got %v", err)
	}
}

// @scenario "The tier can be pinned either way"
func TestAPinnedRuntimeThatIsNotInstalledIsRefused(t *testing.T) {
	facts := PostureFacts{Stated: "colima"}
	posture, _, err := ResolvePosture(facts)
	if err != nil {
		t.Fatalf("ResolvePosture: %v", err)
	}
	err = PostureUnavailable(posture, facts)
	if err == nil {
		t.Fatal("pinning colima on a machine without it must fail rather than silently fall back")
	}
	if !strings.Contains(err.Error(), "colima") {
		t.Errorf("error %q must name what is missing", err)
	}

	// A DETECTED posture is derived from the same facts, so it can never
	// contradict them and must never be refused.
	detected, _, _ := ResolvePosture(PostureFacts{ColimaInstalled: true, DockerInstalled: true})
	if err := PostureUnavailable(detected, PostureFacts{ColimaInstalled: true, DockerInstalled: true}); err != nil {
		t.Errorf("a detected posture must always be available, got %v", err)
	}
}

// @scenario "The tier can be pinned either way"
func TestAnUnknownPostureIsAnErrorNotAFallback(t *testing.T) {
	_, _, err := ResolvePosture(PostureFacts{Stated: "podman", ColimaInstalled: true})
	if err == nil {
		t.Fatal("an unrecognised posture must fail — the point of stating it is that it is not guessed at")
	}
	if !strings.Contains(err.Error(), "colima") || !strings.Contains(err.Error(), "none") {
		t.Errorf("error %q should list what is accepted", err)
	}
}

// The spellings people actually reach for. Refusing over a synonym helps
// nobody, and "nocon" is what this one got called while it was being built.
// @scenario "The tier can be pinned either way"
func TestPostureSynonyms(t *testing.T) {
	for _, tc := range []struct {
		in   string
		want ContainerPosture
	}{
		{"colima", PostureColima},
		{"COLIMA", PostureColima},
		{"docker", PostureDocker},
		{"docker-desktop", PostureDocker},
		{"orbstack", PostureDocker},
		{"none", PostureNone},
		{"nocon", PostureNone},
		{"off", PostureNone},
		{"native", PostureNone},
		{" none ", PostureNone},
	} {
		got, ok := ParsePosture(tc.in)
		if !ok || got != tc.want {
			t.Errorf("ParsePosture(%q) = %v, %v; want %v", tc.in, got, ok, tc.want)
		}
	}
	if _, ok := ParsePosture("kubernetes"); ok {
		t.Error("an unrecognised word must not parse")
	}
}

// @scenario "A machine with no container runtime uses the native tier"
func TestOnlyARuntimePostureUsesContainers(t *testing.T) {
	for posture, wantContainers := range map[ContainerPosture]bool{
		PostureColima: true, PostureDocker: true, PostureNone: false, PostureUnset: false,
	} {
		if posture.UsesContainers() != wantContainers {
			t.Errorf("%v.UsesContainers() = %v, want %v", posture, posture.UsesContainers(), wantContainers)
		}
	}
}

// The line has to say what the posture COSTS, not just name it — "none" is
// the one where something is genuinely unavailable.
// @scenario "The developer is told once, where they will see it"
func TestThePostureLineSaysWhatItMeans(t *testing.T) {
	line := PostureLine(PostureNone, PostureRecorded)
	for _, want := range []string{"none", "natively", "recorded"} {
		if !strings.Contains(line, want) {
			t.Errorf("line %q should mention %q", line, want)
		}
	}
	if !strings.Contains(PostureLine(PostureDocker, PostureDetected), "does not size it") {
		t.Errorf("the docker line should say haven does not manage that daemon, got %q", PostureLine(PostureDocker, PostureDetected))
	}
}
