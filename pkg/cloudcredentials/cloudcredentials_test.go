package cloudcredentials

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestIsAmbient(t *testing.T) {
	for _, name := range Names() {
		assert.True(t, IsAmbient(name), name)
	}
	assert.False(t, IsAmbient("AWS_REGION"))
	assert.False(t, IsAmbient("aws_session_token"), "variable names are case-sensitive")
}

func TestNamesIsACopy(t *testing.T) {
	got := Names()
	got[0] = "CHANGED"
	assert.True(t, IsAmbient("AWS_ACCESS_KEY_ID"))
	assert.NotContains(t, Names(), "CHANGED")
}
