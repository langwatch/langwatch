package ecrtag_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/tools/ecrtag"
)

type call struct {
	stdin string
	argv  []string
}

// recorder answers every command with out, or fails it with err.
type recorder struct {
	calls []call
	out   string
	err   error
}

func (r *recorder) run(_ context.Context, c ecrtag.Command) (string, error) {
	r.calls = append(r.calls, call{stdin: c.Stdin, argv: append([]string{c.Name}, c.Args...)})

	return r.out, r.err
}

var ref = ecrtag.Ref{Repository: "r", Tag: "t"}

func cli(r *recorder) ecrtag.CLI { return ecrtag.CLI{Host: "registry.invalid", Run: r.run} }

func TestDescribe(t *testing.T) {
	t.Run("reads the digest and media type", func(t *testing.T) {
		img, err := cli(&recorder{out: `["sha256:a","` + plain + `"]`}).Describe(context.Background(), ref)
		require.NoError(t, err)
		assert.Equal(t, ecrtag.Image{Digest: "sha256:a", MediaType: plain}, img)
	})
	t.Run("only ImageNotFoundException is not there", func(t *testing.T) {
		_, err := cli(&recorder{err: errors.New("An error occurred (ImageNotFoundException)")}).Describe(context.Background(), ref)
		require.ErrorIs(t, err, ecrtag.ErrNotFound)
	})
	t.Run("any other error is passed on", func(t *testing.T) {
		_, err := cli(&recorder{err: errAccessDenied}).Describe(context.Background(), ref)
		require.ErrorIs(t, err, errAccessDenied)
		assert.NotErrorIs(t, err, ecrtag.ErrNotFound)
	})
}

func TestManifestAcceptsAnIndex(t *testing.T) {
	r := &recorder{out: `["{}","` + index + `"]`}

	m, err := cli(r).Manifest(context.Background(), ref)

	require.NoError(t, err)
	assert.Equal(t, index, m.MediaType)
	argv := strings.Join(r.calls[0].argv, " ")
	assert.Contains(t, argv, "--accepted-media-types")
	assert.Contains(t, argv, "application/vnd.oci.image.index.v1+json")
	assert.Contains(t, argv, "application/vnd.docker.distribution.manifest.list.v2+json")
}

func TestManifestThatIsNotReturnedFails(t *testing.T) {
	_, err := cli(&recorder{out: `null`}).Manifest(context.Background(), ref)
	require.Error(t, err)
}

func TestPut(t *testing.T) {
	m := ecrtag.Manifest{Body: "{}", MediaType: plain}
	t.Run("the same manifest already there is a re-run", func(t *testing.T) {
		err := cli(&recorder{err: errors.New("(ImageAlreadyExistsException)")}).Put(context.Background(), ref, m)
		require.NoError(t, err)
	})
	t.Run("another image already there cannot be moved", func(t *testing.T) {
		err := cli(&recorder{err: errors.New("(ImageTagAlreadyExistsException)")}).Put(context.Background(), ref, m)
		require.ErrorIs(t, err, ecrtag.ErrTagTaken)
	})
	t.Run("any other error is passed on", func(t *testing.T) {
		err := cli(&recorder{err: errAccessDenied}).Put(context.Background(), ref, m)
		require.ErrorIs(t, err, errAccessDenied)
	})
}

func TestLabel(t *testing.T) {
	t.Run("reads a single manifest's label", func(t *testing.T) {
		r := &recorder{out: `{"rootfs":{},"config":{"Labels":{"` + ecrtag.RevisionKey + `":"` + this + `"}}}`}
		label, err := cli(r).Label(context.Background(), ref, ecrtag.RevisionKey)
		require.NoError(t, err)
		assert.Equal(t, this, label)
		assert.Contains(t, r.calls[0].argv, "registry.invalid/r:t")
	})
	t.Run("an index has no image config and is refused", func(t *testing.T) {
		_, err := cli(&recorder{out: `{"linux/arm64":{"config":{}}}`}).Label(context.Background(), ref, ecrtag.RevisionKey)
		require.Error(t, err)
	})
}

func TestScriptHandsTheTagsToTheAncestorScript(t *testing.T) {
	r := &recorder{out: "git-0000002\n"}

	tag, err := ecrtag.Script{Path: "nearest.sh", Run: r.run}.Nearest(context.Background(), []string{"git-a", "git-b"}, this)

	require.NoError(t, err)
	assert.Equal(t, "git-0000002", tag)
	assert.Equal(t, "git-a\ngit-b\n", r.calls[0].stdin)
	assert.Equal(t, []string{"env", "HEAD_COMMIT=" + this, "bash", "nearest.sh"}, r.calls[0].argv)
}
