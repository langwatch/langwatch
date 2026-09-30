package rules

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBasicAnswersAnErrorForAPatternRE2CannotCompile(t *testing.T) {
	output := "foobar"
	settings := CustomBasicSettings{Rules: []CustomBasicRule{{Field: "output", Rule: "matches_regex", Value: "foo(?=bar)"}}}

	passed, _, err := Basic(settings, nil, &output)

	require.Error(t, err)
	assert.False(t, passed)
}
