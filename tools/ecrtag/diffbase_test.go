package ecrtag_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/tools/ecrtag"
)

// registries is one fakeRegistry per repository.
type registries map[string]*fakeRegistry

func (r registries) Describe(ctx context.Context, ref ecrtag.Ref) (ecrtag.Image, error) {
	return r[ref.Repository].Describe(ctx, ref)
}

func (r registries) Tags(ctx context.Context, repository string) ([]string, error) {
	return r[repository].Tags(ctx, repository)
}

func (r registries) Manifest(ctx context.Context, ref ecrtag.Ref) (ecrtag.Manifest, error) {
	return r[ref.Repository].Manifest(ctx, ref)
}

func (r registries) Put(ctx context.Context, ref ecrtag.Ref, m ecrtag.Manifest) error {
	return r[ref.Repository].Put(ctx, ref, m)
}

func (r registries) Label(ctx context.Context, ref ecrtag.Ref, key string) (string, error) {
	return r[ref.Repository].Label(ctx, ref, key)
}

// C is the commit being published; B, whose run was replaced while it waited,
// is its parent, and A, the last published commit, is B's parent.
const (
	tagC = "git-cccccc0"
	tagB = "git-bbbbbb0"
	tagA = "git-aaaaaa0"
	tagZ = "git-0000009"
)

var chain = []string{tagC, tagB, tagA, tagZ}

func diffBase(t *testing.T, repos registries) string {
	t.Helper()
	base, err := ecrtag.DiffBase{
		Registry: repos, Ancestry: &fakeAncestry{history: chain},
		Repositories: []string{"langwatch-app", "langwatch-eval-ragas"}, Tag: tagC, Head: this,
	}.Find(context.Background())
	require.NoError(t, err)

	return base
}

// @scenario "A commit whose run was replaced while it waited still rebuilds what it changed"
func TestTheChangeSetStartsAtTheCommitAReTagWouldCopy(t *testing.T) {
	t.Run("not at the replaced run's commit", func(t *testing.T) {
		base := diffBase(t, registries{
			"langwatch-app":        newRegistry().push(tagA, entry{}).push(tagZ, entry{}),
			"langwatch-eval-ragas": newRegistry().push(tagA, entry{}),
		})
		assert.Equal(t, tagA, base, "B published nothing, so B's changes are in C's change set")
	})
	t.Run("at the furthest back of the images' sources", func(t *testing.T) {
		base := diffBase(t, registries{
			"langwatch-app":        newRegistry().push(tagB, entry{}).push(tagA, entry{}),
			"langwatch-eval-ragas": newRegistry().push(tagA, entry{}),
		})
		assert.Equal(t, tagA, base, "the Lambda image would be re-tagged from A, so A..C decides whether it rebuilds")
	})
	t.Run("never at the commit's own tag, so a re-run diffs what the first run did", func(t *testing.T) {
		base := diffBase(t, registries{
			"langwatch-app":        newRegistry().push(tagC, entry{}).push(tagA, entry{}),
			"langwatch-eval-ragas": newRegistry().push(tagC, entry{}).push(tagA, entry{}),
		})
		assert.Equal(t, tagA, base)
	})
	t.Run("skipping an image that has never been published", func(t *testing.T) {
		base := diffBase(t, registries{
			"langwatch-app":        newRegistry().push(tagB, entry{}),
			"langwatch-eval-ragas": newRegistry(),
		})
		assert.Equal(t, tagB, base)
	})
	t.Run("nowhere when no image has been published", func(t *testing.T) {
		base := diffBase(t, registries{"langwatch-app": newRegistry(), "langwatch-eval-ragas": newRegistry()})
		assert.Empty(t, base, "the run then builds every image")
	})
}

func TestADiffBaseLookupThatDoesNotAnswerFails(t *testing.T) {
	broken := newRegistry().push(tagA, entry{})
	broken.describeErr[tagA] = errAccessDenied

	_, err := ecrtag.DiffBase{
		Registry: registries{"langwatch-app": broken}, Ancestry: &fakeAncestry{history: chain},
		Repositories: []string{"langwatch-app"}, Tag: tagC, Head: this,
	}.Find(context.Background())

	require.ErrorIs(t, err, errAccessDenied)
}
