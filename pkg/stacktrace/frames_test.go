package stacktrace

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetCallerFrames(t *testing.T) {
	frames := GetCallerFrames(1)

	require.NotEmpty(t, frames)
	// The first frame should be this test function.
	assert.Contains(t, frames[0].Function, "TestGetCallerFrames")
	assert.NotEmpty(t, frames[0].File)
	assert.Positive(t, frames[0].Line)
}

func TestFrame_String(t *testing.T) {
	f := Frame{
		Function: "github.com/langwatch/langwatch/pkg/stacktrace.TestFrame_String",
		File:     "/src/frames_test.go",
		Line:     42,
	}

	s := f.String()
	assert.Contains(t, s, "TestFrame_String")
	assert.Contains(t, s, "/src/frames_test.go:42")
	assert.Contains(t, s, "\n\t", "format should be function\\n\\tfile:line")
}

func TestFormatFrames(t *testing.T) {
	frames := []Frame{
		{Function: "funcA", File: "a.go", Line: 1},
		{Function: "funcB", File: "b.go", Line: 2},
	}

	out := FormatFrames(frames)

	assert.Contains(t, out, "funcA")
	assert.Contains(t, out, "funcB")
	assert.Contains(t, out, "a.go:1")
	assert.Contains(t, out, "b.go:2")
}

func TestMergeStacks_EmptyWrapped(t *testing.T) {
	root := []Frame{
		{Function: "a", File: "a.go", Line: 1},
		{Function: "b", File: "b.go", Line: 2},
	}

	merged := MergeStacks(root, nil)

	assert.Equal(t, root, merged)
}

func TestMergeStacks_SingleWrapped(t *testing.T) {
	root := []Frame{
		{Function: "a", File: "a.go", Line: 1},
		{Function: "b", File: "b.go", Line: 2},
	}
	wrapped := []Frame{
		{Function: "extra", File: "extra.go", Line: 10},
	}

	merged := MergeStacks(root, wrapped)

	require.Len(t, merged, 3)
	assert.Equal(t, "a", merged[0].Function)
	assert.Equal(t, "b", merged[1].Function)
	assert.Equal(t, "extra", merged[2].Function)
}
