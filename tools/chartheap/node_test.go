package chartheap

import (
	"errors"
	"os/exec"
	"strconv"
	"strings"
	"testing"
)

// scriptedNode answers docker runs as a Node that reports plain without the ceiling and
// lifted with it, or rejects the flag.
func scriptedNode(plain, lifted float64, rejectFlag bool) Runner {
	return func(_ string, args ...string) (string, error) {
		withCeiling := false
		for _, arg := range args {
			if arg == "NODE_OPTIONS="+Ceiling {
				withCeiling = true
			}
		}
		if !withCeiling {
			return strconv.FormatFloat(plain, 'f', 0, 64), nil
		}
		if rejectFlag {
			return "", errors.New("node: --max-old-space-size-percentage= is not allowed in NODE_OPTIONS")
		}
		return strconv.FormatFloat(lifted, 'f', 0, 64), nil
	}
}

func TestNodeImageReadsTheRuntimeStage(t *testing.T) {
	image, err := NodeImage("../../infra/docker/Dockerfile")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(image, "node:") {
		t.Fatalf("got %q", image)
	}
}

func TestProveCeilingAcceptsThreeQuartersOfTheLimit(t *testing.T) {
	if err := ProveCeiling(scriptedNode(0.5*ProofLimitBytes, 0.78*ProofLimitBytes, false), "node:x"); err != nil {
		t.Fatal(err)
	}
}

func TestProveCeilingRefusesAFlagNodeRejects(t *testing.T) {
	if ProveCeiling(scriptedNode(0.5*ProofLimitBytes, 0, true), "node:x") == nil {
		t.Fatal("a rejected flag passed")
	}
}

func TestProveCeilingRefusesAHeapSizedFromTheMachine(t *testing.T) {
	if ProveCeiling(scriptedNode(0.5*ProofLimitBytes, 12*ProofLimitBytes, false), "node:x") == nil {
		t.Fatal("a heap sized from the machine's memory passed")
	}
}

func TestProveCeilingRefusesAHeapNoLargerThanNodesOwn(t *testing.T) {
	if ProveCeiling(scriptedNode(0.8*ProofLimitBytes, 0.75*ProofLimitBytes, false), "node:x") == nil {
		t.Fatal("a ceiling below Node's own heap passed")
	}
}

// The real proof needs docker; the chart workflow runs it through cmd/chartheap -prove-node.
func TestProveCeilingWithTheImagesNode(t *testing.T) {
	if _, err := exec.LookPath("docker"); err != nil {
		t.Skip("docker is not installed")
	}
	if err := exec.Command("docker", "info").Run(); err != nil {
		t.Skip("docker is not running")
	}
	image, err := NodeImage("../../infra/docker/Dockerfile")
	if err != nil {
		t.Fatal(err)
	}
	if err := ProveCeiling(ExecRunner, image); err != nil {
		t.Fatal(err)
	}
}
