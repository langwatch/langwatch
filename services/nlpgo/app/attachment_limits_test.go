package app

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// @scenario "A requested limit above what an organization can hold is clamped"
func TestResolveMaxAttachmentBytes(t *testing.T) {
	const mib = int64(1024 * 1024)
	cases := []struct {
		name      string
		requested int64
		want      int64
	}{
		{"absent", 0, 20 * mib},
		{"negative", -1, 20 * mib},
		{"below the default", 5 * mib, 5 * mib},
		{"one byte", 1, 1},
		{"the default", 20 * mib, 20 * mib},
		{"above the default", 200 * mib, 200 * mib},
		{"the ceiling", 1024 * mib, 1024 * mib},
		{"one byte past the ceiling", 1024*mib + 1, 1024 * mib},
		{"far past the ceiling", 1 << 50, 1024 * mib},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, ResolveMaxAttachmentBytes(tc.requested))
		})
	}
}

// @scenario "The request body limit fits a dataset row with ten inline images"
func TestDefaultMaxRequestBodyBytes(t *testing.T) {
	const mib = int64(1024 * 1024)
	perFile := 20 * mib
	files := int64(10)

	// ceil(n/3) * 4, written out apart from base64Len so the two agree.
	encoded := perFile / 3
	if perFile%3 != 0 {
		encoded++
	}
	encoded *= 4
	derived := files*encoded + mib

	assert.Equal(t, encoded, base64Len(perFile))
	assert.Equal(t, DefaultMaxAttachmentBytes, perFile)
	assert.Equal(t, AttachmentsPerDatasetRow, files)
	assert.Equal(t, derived, AttachmentsPerDatasetRow*base64Len(DefaultMaxAttachmentBytes)+mib)
	assert.Equal(t, DefaultMaxRequestBodyBytes, derived)
	assert.Equal(t, int64(280668856), DefaultMaxRequestBodyBytes)
}
