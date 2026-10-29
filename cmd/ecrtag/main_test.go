package main

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/tools/ecrtag"
)

func TestParse(t *testing.T) {
	t.Run("-head defaults to -revision", func(t *testing.T) {
		o, err := parse("published", []string{"-repository", "r", "-tag", "t", "-revision", "abc", "-custom=true", "-refuse-retag", "-built-from", "t-arm64"})
		require.NoError(t, err)
		assert.Equal(t, "abc", o.head)
		assert.True(t, o.custom)
		assert.True(t, o.refuseRetag)
		assert.Equal(t, "t-arm64", o.builtFrom)
		assert.Equal(t, "label", o.source)
	})
	t.Run("an explicit -head is kept", func(t *testing.T) {
		o, err := parse("lambda", []string{"-repository", "r", "-tag", "t", "-revision", "abc", "-head", "HEAD", "-built"})
		require.NoError(t, err)
		assert.Equal(t, "HEAD", o.head)
		assert.True(t, o.built)
		assert.Equal(t, "r:t", o.ref().String())
	})
	for _, args := range [][]string{
		{"-tag", "t", "-revision", "abc"},
		{"-repository", "r", "-revision", "abc"},
		{"-repository", "r", "-tag", "t"},
		{"-repository", "r", "-tag", "t", "-revision", "abc", "-custom=maybe"},
		{"-repository", "r", "-tag", "t", "-revision", "abc", "-retag", "accept"},
	} {
		_, err := parse("published", args)
		assert.Error(t, err, args)
	}
}

func TestAnUnknownCommandFails(t *testing.T) {
	require.Error(t, run(t.Context(), "push", options{}))
}

// oneTag is a registry holding one ancestor tag, and the ancestry that picks it.
type oneTag struct{}

func (oneTag) Describe(context.Context, ecrtag.Ref) (ecrtag.Image, error) {
	return ecrtag.Image{Digest: "sha256:ancestor"}, nil
}
func (oneTag) Tags(context.Context, string) ([]string, error) { return []string{"git-0000000"}, nil }
func (oneTag) Manifest(context.Context, ecrtag.Ref) (ecrtag.Manifest, error) {
	return ecrtag.Manifest{}, nil
}
func (oneTag) Put(context.Context, ecrtag.Ref, ecrtag.Manifest) error { return nil }
func (oneTag) Label(context.Context, ecrtag.Ref, string) (string, error) {
	return "", nil
}
func (oneTag) Nearest(_ context.Context, tags []string, _ string) (string, error) {
	return tags[0], nil
}

func TestPublishedAsksAboutEveryFlag(t *testing.T) {
	o, err := parse("published", []string{"-repository", "r", "-tag", "t", "-revision", "abc", "-source", "annotation", "-custom", "-refuse-retag", "-built-from", "t-arm64"})
	require.NoError(t, err)

	c, err := o.check(t.Context(), oneTag{}, oneTag{})

	require.NoError(t, err)
	assert.Equal(t, ecrtag.Check{
		Ref: ecrtag.Ref{Repository: "r", Tag: "t"}, Source: ecrtag.Annotation, Revision: "abc",
		Custom: true, RefuseDigest: "sha256:ancestor", BuiltFrom: "t-arm64",
	}, c, "a re-tag is refused, never accepted")
}

func TestPublishedWithoutRefuseRetagReadsNoAncestor(t *testing.T) {
	o, err := parse("published", []string{"-repository", "r", "-tag", "t", "-revision", "abc"})
	require.NoError(t, err)

	c, err := o.check(t.Context(), oneTag{}, oneTag{})

	require.NoError(t, err)
	assert.Empty(t, c.RefuseDigest)
	assert.Empty(t, c.AcceptDigest)
}
