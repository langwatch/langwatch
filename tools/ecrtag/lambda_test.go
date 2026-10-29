package ecrtag_test

import (
	"bytes"
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/tools/ecrtag"
)

const commitTag = "git-1111111"

// history is HEAD's first-parent chain, nearest first: git-0000002 is the
// parent, git-0000001 an older ancestor. git-5151515 is on another line.
var history = []string{commitTag, "git-0000002", "git-0000001"}

type lambdaRun struct {
	reg *fakeRegistry
	log bytes.Buffer
}

func (r *lambdaRun) publish(tag string, built, custom bool) (bool, error) {
	l := ecrtag.Lambda{
		Registry: r.reg, Ancestry: &fakeAncestry{history: history},
		Ref: ecrtag.Ref{Repository: "langwatch-eval-ragas", Tag: tag}, Head: this, Revision: this,
		Built: built, Custom: custom, Log: &r.log,
	}

	return l.Publish(context.Background())
}

func withTags(entries map[string]entry) *lambdaRun {
	reg := newRegistry()
	for tag, e := range entries {
		reg.push(tag, e)
	}

	return &lambdaRun{reg: reg}
}

// @scenario "An image the commit did not change still gets the commit tag"
func TestAnUnchangedImageGetsTheCommitTag(t *testing.T) {
	run := withTags(map[string]entry{
		"git-0000001": {body: `{"older":true}`},
		"latest":      {body: `{"latest":true}`},
		"git-0000002": {body: `{"newest":true}`},
	})

	written, err := run.publish(commitTag, false, false)

	require.NoError(t, err)
	assert.True(t, written)
	assert.JSONEq(t, `{"newest":true}`, run.reg.tags[commitTag].body)
	assert.Equal(t, plain, run.reg.tags[commitTag].mediaType, "the copy keeps the single-manifest media type")
}

// The choice of ancestor is nearest-ancestor-tag.sh, bound by its own test.
func TestAnImageFromAnotherLineIsNeverRetagged(t *testing.T) {
	run := withTags(map[string]entry{
		"git-0000001": {body: `{"old":true}`},
		"git-5151515": {body: `{"side":true}`},
	})

	_, err := run.publish(commitTag, false, false)

	require.NoError(t, err)
	assert.JSONEq(t, `{"old":true}`, run.reg.tags[commitTag].body)
}

// @scenario "A re-run publishes nothing that is already there"
func TestARetagAlreadyInECRIsLeftAsItIs(t *testing.T) {
	run := withTags(map[string]entry{"git-0000002": {digest: "sha256:mid", body: `{"mid":true}`}})
	// A first run copied git-0000002; the copy keeps that image's label.
	run.reg.push(commitTag, entry{digest: "sha256:mid", body: `{"mid":true}`})

	written, err := run.publish(commitTag, false, false)

	require.NoError(t, err)
	assert.True(t, written)
	assert.Empty(t, run.reg.puts)
}

// @scenario "A re-run publishes nothing that is already there"
func TestATagPublishedForThisCommitIsLeftAsItIs(t *testing.T) {
	run := withTags(map[string]entry{
		"git-0000002": {body: `{"mid":true}`},
		commitTag:     {body: `{"published":true}`, label: this},
	})

	_, err := run.publish(commitTag, false, false)

	require.NoError(t, err)
	assert.JSONEq(t, `{"published":true}`, run.reg.tags[commitTag].body)
	assert.Empty(t, run.reg.puts)
}

// @scenario "A commit tag already there for another commit fails the run"
func TestALambdaTagBuiltFromAnotherCommitFails(t *testing.T) {
	run := withTags(map[string]entry{
		"git-0000002": {body: `{"mid":true}`},
		commitTag:     {body: `{"collision":true}`, label: other},
	})

	_, err := run.publish(commitTag, false, false)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "for commit "+other+", not "+this)
	assert.Empty(t, run.reg.puts)
}

// @scenario "A commit tag already there that records no commit fails the run"
func TestALambdaTagWithNoRevisionFailsClosed(t *testing.T) {
	run := withTags(map[string]entry{
		"git-0000002": {body: `{"mid":true}`},
		commitTag:     {body: `{"unlabelled":true}`},
	})

	_, err := run.publish(commitTag, false, false)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "records no "+ecrtag.RevisionKey)
	assert.Empty(t, run.reg.puts)
}

// @scenario "A dispatch with a custom tag that is already there fails the run"
func TestACustomLambdaTag(t *testing.T) {
	t.Run("already there fails and writes nothing", func(t *testing.T) {
		run := withTags(map[string]entry{
			"git-0000002": {digest: "sha256:mid", body: `{"mid":true}`},
			"hotfix-1":    {digest: "sha256:mid", body: `{"mid":true}`, label: this},
		})
		_, err := run.publish("hotfix-1", false, true)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "pick a new image_tag")
		assert.Empty(t, run.reg.puts)
	})
	t.Run("not yet there is written", func(t *testing.T) {
		run := withTags(map[string]entry{"git-0000002": {body: `{"mid":true}`}})
		_, err := run.publish("hotfix-2", false, true)
		require.NoError(t, err)
		assert.JSONEq(t, `{"mid":true}`, run.reg.tags["hotfix-2"].body)
	})
}

// @scenario "A lookup that does not answer whether a tag is there fails the run"
func TestAFailedExistenceCheckWritesNothing(t *testing.T) {
	run := withTags(map[string]entry{"git-0000002": {body: `{"mid":true}`}})
	run.reg.describeErr[commitTag] = errAccessDenied

	_, err := run.publish(commitTag, false, false)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "AccessDeniedException")
	assert.Empty(t, run.reg.puts)
}

// @scenario "A tag that already names another image fails the run"
func TestATagHoldingAnotherImageFails(t *testing.T) {
	run := withTags(map[string]entry{"git-0000002": {body: `{"mid":true}`}})
	run.reg.putErr = ecrtag.ErrTagTaken

	_, err := run.publish(commitTag, false, false)

	require.ErrorIs(t, err, ecrtag.ErrTagTaken)
	assert.Contains(t, err.Error(), "cannot be moved")
}

// @scenario "A tag that cannot be written fails the run"
func TestATagThatCannotBeWrittenFails(t *testing.T) {
	run := withTags(map[string]entry{"git-0000002": {body: `{"mid":true}`}})
	run.reg.putErr = errAccessDenied

	_, err := run.publish(commitTag, false, false)

	require.ErrorIs(t, err, errAccessDenied)
}

// @scenario "A Lambda image is never re-tagged from an index"
func TestALambdaImageIsNeverRetaggedFromAnIndex(t *testing.T) {
	run := withTags(map[string]entry{"git-0000002": {mediaType: index, body: `{"index":true}`}})

	_, err := run.publish(commitTag, false, false)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "not a single manifest")
	assert.Empty(t, run.reg.puts)
}

// @scenario "A Lambda image is never re-tagged from an index"
func TestARebuiltIndexFails(t *testing.T) {
	run := withTags(map[string]entry{commitTag: {mediaType: index}})

	_, err := run.publish(commitTag, true, false)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "not a single manifest")
}

// @scenario "A Lambda image whose build did not push its tag fails the run"
func TestALambdaImageThatWasNotBuiltFails(t *testing.T) {
	run := withTags(map[string]entry{"git-0000002": {body: `{"newest":true}`}})

	_, err := run.publish(commitTag, true, false)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "was due to be built")
	assert.NotContains(t, run.reg.tags, commitTag, "it does not fall back to an older image")
}

func TestAFailedLookupOfARebuiltTagShowsTheRegistryError(t *testing.T) {
	run := withTags(map[string]entry{commitTag: {}})
	run.reg.describeErr[commitTag] = errAccessDenied

	_, err := run.publish(commitTag, true, false)

	require.ErrorIs(t, err, errAccessDenied)
	assert.NotContains(t, err.Error(), "was due to be built")
}

func TestARebuiltSingleManifestPasses(t *testing.T) {
	run := withTags(map[string]entry{commitTag: {}})

	written, err := run.publish(commitTag, true, false)

	require.NoError(t, err)
	assert.True(t, written)
}

// @scenario "A Lambda image with no earlier image is left unpublished with a warning"
func TestAnImageWithNoEarlierImageWarnsAndWritesNothing(t *testing.T) {
	run := withTags(map[string]entry{"latest": {body: `{"latest":true}`}})

	written, err := run.publish(commitTag, false, false)

	require.NoError(t, err)
	assert.False(t, written)
	assert.Contains(t, run.log.String(), "::warning::")
	assert.Contains(t, run.log.String(), "has no previous git-* image")
	assert.Empty(t, run.reg.puts)
}
