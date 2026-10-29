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

// @scenario "A dispatch with a custom tag that is already there fails the run"
// @scenario "A private build never reuses a custom tag"
func TestACustomTagAlreadyThereFails(t *testing.T) {
	c := check("hotfix-1", ecrtag.Label)
	c.Custom = true
	_, err := published(t, c)
	require.Error(t, err, "even when it records this commit")
	assert.Contains(t, err.Error(), "pick a new image_tag")

	c.AcceptDigest = "sha256:hotfix"
	_, err = published(t, c)
	require.Error(t, err, "even when it names the manifest a re-tag would copy")
	assert.Contains(t, err.Error(), "pick a new image_tag")
}

// @scenario "A private build never reuses a custom tag"
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
