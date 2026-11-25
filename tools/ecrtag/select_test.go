package ecrtag_test

import (
	"context"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/tools/ecrtag"
)

var gateway = []ecrtag.ImageSpec{{Image: "gateway", Dockerfile: "infra/docker/Dockerfile.go", Row: `{"image":"gateway"}`}}

func gatewayHash(t *testing.T) string {
	t.Helper()
	h, err := inputsOf(goTree(), goDockerfile).Hash(context.Background(), gateway[0])
	require.NoError(t, err)
	return h
}

func plan(t *testing.T, reg *fakeRegistry, all bool) ecrtag.Plan {
	t.Helper()
	plans, err := ecrtag.Select{
		Registry: reg, Ancestry: &fakeAncestry{history: []string{"git-b", "git-a"}},
		Inputs: inputsOf(goTree(), goDockerfile), Tag: "git-c", Head: this, All: all,
	}.Plan(context.Background(), gateway)
	require.NoError(t, err)
	require.Len(t, plans, 1)
	return plans[0]
}

// @scenario "An image the commit did not change still gets the commit tag"
func TestAnImageWithTheSameInputsAsItsReTagIsNotBuilt(t *testing.T) {
	reg := newRegistry().push("git-b", entry{inputs: gatewayHash(t)}).push("git-a", entry{inputs: "older"})

	p := plan(t, reg, false)

	assert.False(t, p.Build, p.Reason)
	assert.Equal(t, gatewayHash(t), p.Inputs)
	assert.Equal(t, "same inputs as git-b", p.Reason)
}

// @scenario "A commit whose run was replaced while it waited still rebuilds what it changed"
// @scenario "An image published after the change set's start is rebuilt even when a revert empties the diff"
func TestAnImageIsBuiltUnlessItsReTagHasTheSameInputs(t *testing.T) {
	for name, c := range map[string]struct {
		reg    *fakeRegistry
		reason string
	}{
		"the image the re-tag copies was built from other inputs": {
			newRegistry().push("git-b", entry{inputs: "other"}).push("git-a", entry{inputs: "same-as-a-revert"}),
			"inputs changed since git-b",
		},
		"the image the re-tag copies records no inputs": {
			newRegistry().push("git-b", entry{}), "git-b records no inputs",
		},
		"the image the re-tag copies is an index over more than one image": {
			newRegistry().push("git-b", entry{labelErr: fmt.Errorf("%w: two platforms", ecrtag.ErrNotOneImage)}),
			"git-b is not one image (not one image: two platforms)",
		},
		"no ancestor has an image": {
			newRegistry().push("git-elsewhere", entry{}), "no ancestor has an image to re-tag",
		},
	} {
		t.Run(name, func(t *testing.T) {
			p := plan(t, c.reg, false)
			assert.True(t, p.Build)
			assert.Equal(t, c.reason, p.Reason)
			assert.Equal(t, gatewayHash(t), p.Inputs, "the build is labeled with its inputs")
		})
	}
}

func TestADispatchBuildsEveryImageAndReadsNoRegistry(t *testing.T) {
	reg := newRegistry().push("git-b", entry{inputs: gatewayHash(t)})
	reg.describeErr["git-b"] = errAccessDenied

	p := plan(t, reg, true)

	assert.True(t, p.Build)
	assert.Equal(t, gatewayHash(t), p.Inputs)
}

// @scenario "An image whose inputs cannot be read is rebuilt"
func TestAnImageWhoseInputsCannotBeReadIsBuilt(t *testing.T) {
	in := inputsOf(goTree(), "FROM golang\nCOPY cmd ./cmd\nRUN go build github.com/x/y\n")
	plans, err := ecrtag.Select{
		Registry: newRegistry().push("git-b", entry{inputs: ""}), Ancestry: &fakeAncestry{history: []string{"git-b"}},
		Inputs: in, Tag: "git-c", Head: this,
	}.Plan(context.Background(), gateway)
	require.NoError(t, err)

	assert.True(t, plans[0].Build)
	assert.Empty(t, plans[0].Inputs)
	assert.Contains(t, plans[0].Reason, "could not be read")
}

func TestARegistryThatDoesNotAnswerFailsTheRun(t *testing.T) {
	for name, reg := range map[string]*fakeRegistry{
		"the tags": func() *fakeRegistry {
			r := newRegistry().push("git-b", entry{})
			r.describeErr["git-b"] = errAccessDenied
			return r
		}(),
		"the label": newRegistry().push("git-b", entry{labelErr: errAccessDenied}),
	} {
		t.Run(name, func(t *testing.T) {
			_, err := ecrtag.Select{
				Registry: reg, Ancestry: &fakeAncestry{history: []string{"git-b"}},
				Inputs: inputsOf(goTree(), goDockerfile), Tag: "git-c", Head: this,
			}.Plan(context.Background(), gateway)
			assert.Error(t, err)
		})
	}
}
