package domain

import (
	"fmt"
	"sort"
	"strings"
)

// A machine's container posture is the one question everything container-shaped
// downstream is really asking: colima, Docker Desktop, or nothing at all.
//
// It used to be asked three times, in three vocabularies, by three subsystems
// that could disagree — LANGWATCH_HAVEN_CH=0 for ClickHouse,
// LANGWATCH_HAVEN_OBS=0 for the telemetry stack, LANGY_UNSAFE_HOST_ACCESS for
// the langy worker — so "I don't want containers on this laptop" was three
// environment variables to find and set, and setting two of them left a stack
// that still wanted a VM. One stated answer now drives all of them.
//
// Stated, not inferred. haven can see what is installed, and it falls back to
// that, but a developer who has colima installed for something else is not
// thereby asking haven to use it.

// ContainerPosture is the answer.
type ContainerPosture int

const (
	// PostureUnset: nobody has said, so haven will look at the machine.
	PostureUnset ContainerPosture = iota
	// PostureColima: the colima VM, which is what haven sizes and caps.
	PostureColima
	// PostureDocker: whatever daemon the `docker` CLI already talks to —
	// Docker Desktop, OrbStack, a remote context. haven does not manage it.
	PostureDocker
	// PostureNone: no container runtime, by choice. Every tier that would
	// have used one runs natively or not at all.
	PostureNone
)

// PostureNames is the spelling of each, and the vocabulary the CLI accepts.
var PostureNames = map[ContainerPosture]string{
	PostureUnset:  "unset",
	PostureColima: "colima",
	PostureDocker: "docker",
	PostureNone:   "none",
}

func (p ContainerPosture) String() string {
	if name, ok := PostureNames[p]; ok {
		return name
	}
	return "unset"
}

// UsesContainers reports whether this posture has a runtime to talk to at all.
func (p ContainerPosture) UsesContainers() bool {
	return p == PostureColima || p == PostureDocker
}

// ParsePosture reads a stated posture. Case-insensitive, and it accepts the
// spellings people actually reach for — "docker-desktop" for docker, "off"
// and "no" for none — because a refusal over a synonym helps nobody.
func ParsePosture(s string) (ContainerPosture, bool) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "":
		return PostureUnset, true
	case "colima":
		return PostureColima, true
	case "docker", "docker-desktop", "desktop", "orbstack":
		return PostureDocker, true
	case "none", "off", "no", "native", "nocon":
		return PostureNone, true
	}
	return PostureUnset, false
}

// PostureChoices is what to offer someone who has not said, in the order
// haven recommends them.
func PostureChoices() []string { return []string{"colima", "docker", "none"} }

// PostureSource is where the answer came from, so haven can say why it is
// doing what it is doing — the difference between a decision the developer
// made and one haven made for them.
type PostureSource int

const (
	// PostureStated: an environment variable, for this run.
	PostureStated PostureSource = iota
	// PostureRecorded: the developer chose it once and haven wrote it down.
	PostureRecorded
	// PostureDetected: nobody said, so haven used what is installed.
	PostureDetected
)

func (s PostureSource) String() string {
	switch s {
	case PostureStated:
		return "stated"
	case PostureRecorded:
		return "recorded"
	default:
		return "detected"
	}
}

// PostureFacts is everything the resolution looks at.
type PostureFacts struct {
	// Stated is the environment variable, empty when unset.
	Stated string
	// Recorded is what the developer chose previously, empty when never.
	Recorded string
	// ColimaInstalled and DockerInstalled are what is on this machine.
	// Colima needs the docker CLI too, so ColimaInstalled means both.
	ColimaInstalled bool
	DockerInstalled bool
}

// ResolvePosture applies the precedence: what was said for this run, then
// what was chosen before, then what the machine has. A stated posture that
// names nothing valid is an error rather than a silent fallback — the whole
// point of stating it is that it is not guessed at.
func ResolvePosture(f PostureFacts) (ContainerPosture, PostureSource, error) {
	if f.Stated != "" {
		p, ok := ParsePosture(f.Stated)
		if !ok {
			return PostureUnset, PostureStated, fmt.Errorf(
				"%q is not a container posture — use one of: %s", f.Stated, strings.Join(PostureChoices(), ", "))
		}
		if p != PostureUnset {
			return p, PostureStated, nil
		}
	}
	if p, ok := ParsePosture(f.Recorded); ok && p != PostureUnset {
		return p, PostureRecorded, nil
	}
	// Nobody has said. colima first: it is the one haven sizes, caps and can
	// start itself, so where both exist it is the better default.
	switch {
	case f.ColimaInstalled:
		return PostureColima, PostureDetected, nil
	case f.DockerInstalled:
		return PostureDocker, PostureDetected, nil
	}
	// Nothing installed is not a problem to report — it is an answer, and
	// since every tier has a native or disabled form it is a workable one.
	return PostureNone, PostureDetected, nil
}

// PostureUnavailable explains a posture that cannot be honoured on this
// machine: a pinned runtime whose binaries are not there. It returns nil when
// the posture is fine. Only a STATED posture should be checked this way — a
// detected one is derived from the same facts and cannot contradict them.
func PostureUnavailable(p ContainerPosture, f PostureFacts) error {
	switch {
	case p == PostureColima && !f.ColimaInstalled:
		return fmt.Errorf("container posture is colima, but colima and the docker CLI are not both installed — `haven install runtime=colima`, or choose another with %s", PostureEnvVar)
	case p == PostureDocker && !f.DockerInstalled:
		return fmt.Errorf("container posture is docker, but the docker CLI is not installed — `haven install runtime=docker-desktop`, or choose another with %s", PostureEnvVar)
	}
	return nil
}

// PostureEnvVar states the posture for one run, overriding what was recorded.
const PostureEnvVar = "LANGWATCH_HAVEN_CONTAINERS"

// PostureLine is the one line haven prints when the posture shapes what it
// just did — which tiers it chose and why.
func PostureLine(p ContainerPosture, source PostureSource) string {
	switch p {
	case PostureNone:
		return fmt.Sprintf("containers: none (%s) — ClickHouse and telemetry run natively, langy on the host tier", source)
	case PostureDocker:
		return fmt.Sprintf("containers: docker (%s) — using whatever daemon the docker CLI talks to; haven does not size it", source)
	default:
		return fmt.Sprintf("containers: colima (%s)", source)
	}
}

// SortedPostureNames is every spelling haven accepts, for help and errors.
func SortedPostureNames() []string {
	names := make([]string, 0, len(PostureNames))
	for p, name := range PostureNames {
		if p != PostureUnset {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	return names
}
