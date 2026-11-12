package ecrtag_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/tools/ecrtag"
)

func annotated(revision string) string {
	return `{"annotations":{"` + ecrtag.RevisionKey + `":"` + revision + `"}}`
}

func registryOfTags() *fakeRegistry {
	return newRegistry().
		push("git-1111111-arm64", entry{label: this}).
		push("git-1111112-arm64", entry{label: other}).
		push("git-1111113-arm64", entry{digest: "sha256:old"}).
		push("git-1111111", entry{mediaType: index, body: annotated(this)}).
		push("git-1111112", entry{mediaType: index, body: annotated(other)}).
		push("git-1111113", entry{mediaType: index, body: `{"manifests":[]}`}).
		push("hotfix-1", entry{digest: "sha256:hotfix", label: this})
}

func check(tag string, source ecrtag.Source) ecrtag.Check {
	return ecrtag.Check{Ref: ecrtag.Ref{Repository: "langwatch-app", Tag: tag}, Source: source, Revision: this}
}

func published(t *testing.T, c ecrtag.Check) (bool, error) {
	t.Helper()

	return ecrtag.Published(context.Background(), registryOfTags(), c)
}

// @scenario "A re-run publishes nothing that is already there"
func TestATagThatIsNotThereIsPushed(t *testing.T) {
	done, err := published(t, check("git-2222222-arm64", ecrtag.Label))
	require.NoError(t, err)
	assert.False(t, done)

	custom := check("hotfix-2", ecrtag.Annotation)
	custom.Custom = true
	done, err = published(t, custom)
	require.NoError(t, err)
	assert.False(t, done, "a custom tag not there is pushed")
}

// @scenario "A re-run publishes nothing that is already there"
func TestATagRecordingThisCommitIsSkipped(t *testing.T) {
	retag := check("git-1111113-arm64", ecrtag.Label)
	retag.AcceptDigest = "sha256:old"
	for name, c := range map[string]ecrtag.Check{
		"a built image recording this commit":      check("git-1111111-arm64", ecrtag.Label),
		"an index annotated with this commit":      check("git-1111111", ecrtag.Annotation),
		"exactly the manifest a re-tag would copy": retag,
	} {
		t.Run(name, func(t *testing.T) {
			done, err := published(t, c)
			require.NoError(t, err)
			assert.True(t, done)
		})
	}
}

// @scenario "A commit tag already there for another commit fails the run"
func TestATagRecordingAnotherCommitFails(t *testing.T) {
	retag := check("git-1111112-arm64", ecrtag.Label)
	retag.AcceptDigest = "sha256:old"
	for name, c := range map[string]ecrtag.Check{
		"an image recording another commit":                 check("git-1111112-arm64", ecrtag.Label),
		"an index annotated with another commit":            check("git-1111112", ecrtag.Annotation),
		"another manifest than the one a re-tag would copy": retag,
	} {
		t.Run(name, func(t *testing.T) {
			done, err := published(t, c)
			require.Error(t, err)
			assert.False(t, done)
			assert.Contains(t, err.Error(), "for commit "+other+", not "+this)
		})
	}
}

// @scenario "A commit tag already there that records no commit fails the run"
func TestATagRecordingNoCommitFailsClosed(t *testing.T) {
	for _, c := range []ecrtag.Check{check("git-1111113-arm64", ecrtag.Label), check("git-1111113", ecrtag.Annotation)} {
		done, err := published(t, c)
		require.Error(t, err)
		assert.False(t, done)
		assert.Contains(t, err.Error(), "records no "+ecrtag.RevisionKey)
	}
}

// @scenario "A dispatch whose custom tag is already there for another commit or none fails the run"
// @scenario "A re-run of a dispatch with a custom tag publishes nothing already there"
// @scenario "A private build reuses a tag only for the commit it records"
func TestACustomTagAlreadyThere(t *testing.T) {
	reg := registryOfTags().
		push("hotfix-other", entry{label: other}).
		push("hotfix-bare", entry{digest: "sha256:bare"})
	custom := func(tag string) ecrtag.Check {
		c := check(tag, ecrtag.Label)
		c.Custom = true
		return c
	}

	t.Run("recording this commit is a re-run of a partly failed dispatch, and is skipped", func(t *testing.T) {
		done, err := ecrtag.Published(context.Background(), reg, custom("hotfix-1"))
		require.NoError(t, err)
		assert.True(t, done)
	})
	t.Run("recording another commit fails and asks for a new tag", func(t *testing.T) {
		_, err := ecrtag.Published(context.Background(), reg, custom("hotfix-other"))
		require.Error(t, err)
		assert.Contains(t, err.Error(), "pick a new image_tag")
	})
	t.Run("recording no commit fails, even naming the manifest a re-tag would copy", func(t *testing.T) {
		c := custom("hotfix-bare")
		c.AcceptDigest = "sha256:bare"
		_, err := ecrtag.Published(context.Background(), reg, c)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "pick a new image_tag")
	})
}

// @scenario "A private build reuses a tag only for the commit it records"
func TestADefaultTagAlreadyThereForThisCommitIsSkipped(t *testing.T) {
	reg := newRegistry().push("ref-1111111aaa", entry{label: this}).push("ref-1111111bbb", entry{label: other})

	done, err := ecrtag.Published(context.Background(), reg, ecrtag.Check{Ref: ecrtag.Ref{Repository: "langwatch-app", Tag: "ref-1111111aaa"}, Source: ecrtag.Label, Revision: this})
	require.NoError(t, err)
	assert.True(t, done)

	_, err = ecrtag.Published(context.Background(), reg, ecrtag.Check{Ref: ecrtag.Ref{Repository: "langwatch-app", Tag: "ref-1111111bbb"}, Source: ecrtag.Label, Revision: this})
	require.Error(t, err, "a default tag a custom dispatch wrote for another commit")
}

// @scenario "A lookup that does not answer whether a tag is there fails the run"
func TestAFailedLookupFails(t *testing.T) {
	reg := registryOfTags()
	reg.describeErr["git-1111111-arm64"] = errAccessDenied

	done, err := ecrtag.Published(context.Background(), reg, check("git-1111111-arm64", ecrtag.Label))

	require.Error(t, err)
	assert.False(t, done)
	assert.Contains(t, err.Error(), "AccessDeniedException")
}

func TestAnUnknownSourceFails(t *testing.T) {
	_, err := published(t, check("git-1111111", "digest"))
	require.Error(t, err)
}

// @scenario "A re-run publishes nothing that is already there"
func TestARetagNeverOffersTheTagItself(t *testing.T) {
	reg := newRegistry().push("git-1111111", entry{}).push("git-0000001", entry{digest: "sha256:mid"})
	anc := &fakeAncestry{history: []string{"git-1111111", "git-0000001"}}

	retag := ecrtag.Retag{Registry: reg, Ancestry: anc, Ref: ecrtag.Ref{Repository: "r", Tag: "git-1111111"}, Head: this}
	previous, digest, err := retag.Source(context.Background())

	require.NoError(t, err)
	assert.Equal(t, "git-0000001", previous)
	assert.Equal(t, "sha256:mid", digest)
	assert.NotContains(t, anc.offered, "git-1111111")
}

// @scenario "A dispatch with a new custom tag over a published commit writes that tag"
func TestANewCustomTagOverAPublishedCommitIsWritten(t *testing.T) {
	c := check("hotfix-2", ecrtag.Annotation)
	c.Custom = true

	done, err := published(t, c) // git-1111111 is already there for this commit

	require.NoError(t, err)
	assert.False(t, done, "the custom tag is not there, so it is written")
}

// @scenario "A dispatch that rebuilds an image a push run re-tagged fails the run"
func TestAnIndexTagMustNameTheManifestThisRunBuilt(t *testing.T) {
	reg := newRegistry().
		push("git-1111111-arm64", entry{digest: "sha256:built", label: this}).
		push("git-1111111", entry{mediaType: index, body: `{"manifests":[{"digest":"sha256:built"}],` + annotated(this)[1:]}).
		push("git-2222222-arm64", entry{digest: "sha256:built2", label: this}).
		// A push run re-tagged the ancestor's index and annotated it with this commit.
		push("git-2222222", entry{mediaType: index, body: `{"manifests":[{"digest":"sha256:ancestor"}],` + annotated(this)[1:]}).
		push("git-3333333-arm64", entry{digest: "sha256:built3", label: this}).
		// An index naming this run's build beside another manifest.
		push("git-3333333", entry{mediaType: index, body: `{"manifests":[{"digest":"sha256:built3"},{"digest":"sha256:ancestor"}],` + annotated(this)[1:]})
	built := func(tag string) ecrtag.Check {
		c := check(tag, ecrtag.Annotation)
		c.BuiltFrom = tag + "-arm64"
		return c
	}

	done, err := ecrtag.Published(context.Background(), reg, built("git-1111111"))
	require.NoError(t, err)
	assert.True(t, done, "an index over this run's build is skipped")

	_, err = ecrtag.Published(context.Background(), reg, built("git-2222222"))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "re-tagged by a push run")

	_, err = ecrtag.Published(context.Background(), reg, built("git-3333333"))
	require.Error(t, err, "an index naming more than this run's build")
	assert.Contains(t, err.Error(), "re-tagged by a push run")
}

// @scenario "A dispatch that rebuilds an image a push run re-tagged fails the run"
func TestARefusedRetagFails(t *testing.T) {
	c := check("git-1111113-arm64", ecrtag.Label)
	c.RefuseDigest = "sha256:old"

	_, err := published(t, c)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "re-tagged by a push run")
}
