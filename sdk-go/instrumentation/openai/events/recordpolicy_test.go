package events

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// TestNewProtectedContentRecordPolicy tests the creation of a new protected content record policy
func TestNewProtectedContentRecordPolicy(t *testing.T) {
	policy := NewProtectedContentRecordPolicy()

	// All recording should be disabled by default
	assert.False(t, policy.GetRecordSystemInputContent())
	assert.False(t, policy.GetRecordUserInputContent())
	assert.False(t, policy.GetRecordOutputContent())
}

// TestContentRecordPolicy_SystemInputContent tests system input content recording configuration
func TestContentRecordPolicy_SystemInputContent(t *testing.T) {
	policy := NewProtectedContentRecordPolicy()

	// Initially should be false
	assert.False(t, policy.GetRecordSystemInputContent())

	// Enable recording
	policy.SetRecordSystemInputContent(true)
	assert.True(t, policy.GetRecordSystemInputContent())

	// Disable recording
	policy.SetRecordSystemInputContent(false)
	assert.False(t, policy.GetRecordSystemInputContent())
}

// TestContentRecordPolicy_UserInputContent tests user input content recording configuration
func TestContentRecordPolicy_UserInputContent(t *testing.T) {
	policy := NewProtectedContentRecordPolicy()

	// Initially should be false
	assert.False(t, policy.GetRecordUserInputContent())

	// Enable recording
	policy.SetRecordUserInputContent(true)
	assert.True(t, policy.GetRecordUserInputContent())

	// Disable recording
	policy.SetRecordUserInputContent(false)
	assert.False(t, policy.GetRecordUserInputContent())
}

// TestContentRecordPolicy_OutputContent tests output content recording configuration
func TestContentRecordPolicy_OutputContent(t *testing.T) {
	policy := NewProtectedContentRecordPolicy()

	// Initially should be false
	assert.False(t, policy.GetRecordOutputContent())

	// Enable recording
	policy.SetRecordOutputContent(true)
	assert.True(t, policy.GetRecordOutputContent())

	// Disable recording
	policy.SetRecordOutputContent(false)
	assert.False(t, policy.GetRecordOutputContent())
}

// TestContentRecordPolicy_AllSettings tests all settings together
func TestContentRecordPolicy_AllSettings(t *testing.T) {
	policy := NewProtectedContentRecordPolicy()

	// Enable all
	policy.SetRecordSystemInputContent(true)
	policy.SetRecordUserInputContent(true)
	policy.SetRecordOutputContent(true)

	assert.True(t, policy.GetRecordSystemInputContent())
	assert.True(t, policy.GetRecordUserInputContent())
	assert.True(t, policy.GetRecordOutputContent())

	// Disable all
	policy.SetRecordSystemInputContent(false)
	policy.SetRecordUserInputContent(false)
	policy.SetRecordOutputContent(false)

	assert.False(t, policy.GetRecordSystemInputContent())
	assert.False(t, policy.GetRecordUserInputContent())
	assert.False(t, policy.GetRecordOutputContent())
}

// TestContentRecordPolicy_IndependentSettings tests that settings are independent
func TestContentRecordPolicy_IndependentSettings(t *testing.T) {
	policy := NewProtectedContentRecordPolicy()

	// Enable only system input
	policy.SetRecordSystemInputContent(true)
	assert.True(t, policy.GetRecordSystemInputContent())
	assert.False(t, policy.GetRecordUserInputContent())
	assert.False(t, policy.GetRecordOutputContent())

	// Enable only user input
	policy.SetRecordSystemInputContent(false)
	policy.SetRecordUserInputContent(true)
	assert.False(t, policy.GetRecordSystemInputContent())
	assert.True(t, policy.GetRecordUserInputContent())
	assert.False(t, policy.GetRecordOutputContent())

	// Enable only output
	policy.SetRecordUserInputContent(false)
	policy.SetRecordOutputContent(true)
	assert.False(t, policy.GetRecordSystemInputContent())
	assert.False(t, policy.GetRecordUserInputContent())
	assert.True(t, policy.GetRecordOutputContent())
}
