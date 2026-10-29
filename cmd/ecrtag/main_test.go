package main

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParse(t *testing.T) {
	t.Run("-head defaults to -revision", func(t *testing.T) {
		o, err := parse("published", []string{"-repository", "r", "-tag", "t", "-revision", "abc", "-custom=true", "-accept-retag"})
		require.NoError(t, err)
		assert.Equal(t, "abc", o.head)
		assert.True(t, o.custom)
		assert.True(t, o.acceptRetag)
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
	} {
		_, err := parse("published", args)
		assert.Error(t, err, args)
	}
}

func TestAnUnknownCommandFails(t *testing.T) {
	require.Error(t, run(t.Context(), "push", options{}))
}
