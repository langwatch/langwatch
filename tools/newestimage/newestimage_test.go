package newestimage_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/tools/newestimage"
)

const index = "application/vnd.oci.image.index.v1+json"

// @scenario "The newest plain model image is picked"
func TestPicksTheNewestImageWithThePrefix(t *testing.T) {
	data := []byte(`{"imageDetails": [
	  {"imageDigest": "sha256:old", "imageTags": ["http-git-aaaaaaa"], "imagePushedAt": "2026-11-01T10:00:00+00:00", "imageManifestMediaType": "` + index + `"},
	  {"imageDigest": "sha256:lambda", "imageTags": ["git-ccccccc"], "imagePushedAt": "2026-11-17T10:00:00+00:00", "imageManifestMediaType": "application/vnd.docker.distribution.manifest.v2+json"},
	  {"imageDigest": "sha256:new", "imageTags": ["http-git-bbbbbbb"], "imagePushedAt": "2026-11-16T09:30:00.123000+00:00", "imageManifestMediaType": "application/vnd.docker.distribution.manifest.list.v2+json"},
	  {"imageDigest": "sha256:untagged", "imagePushedAt": "2026-11-18T10:00:00+00:00", "imageManifestMediaType": "` + index + `"}
	]}`)

	got, err := newestimage.Pick(data, "http-git-")

	require.NoError(t, err)
	assert.Equal(t, newestimage.Image{Tag: "http-git-bbbbbbb", Digest: "sha256:new"}, got)
	assert.Equal(t, "tag=http-git-bbbbbbb\ndigest=sha256:new\n", got.Outputs())
}

// @scenario "An image for one chip type only is refused"
func TestRefusesASinglePlatformImage(t *testing.T) {
	data := []byte(`{"imageDetails": [
	  {"imageDigest": "sha256:one", "imageTags": ["http-git-aaaaaaa"], "imagePushedAt": "2026-11-01T10:00:00Z", "imageManifestMediaType": "application/vnd.oci.image.manifest.v1+json"}
	]}`)

	_, err := newestimage.Pick(data, "http-git-")

	require.Error(t, err)
	assert.Contains(t, err.Error(), "http-git-aaaaaaa")
}

// @scenario "No plain model image fails the release"
func TestFailsWhenNoImageHasThePrefix(t *testing.T) {
	data := []byte(`{"imageDetails": [
	  {"imageDigest": "sha256:lambda", "imageTags": ["git-ccccccc"], "imagePushedAt": "2026-11-17T10:00:00Z", "imageManifestMediaType": "` + index + `"}
	]}`)

	_, err := newestimage.Pick(data, "http-git-")

	require.ErrorIs(t, err, newestimage.ErrNone)
}

func TestFailsOnOutputItCannotRead(t *testing.T) {
	_, err := newestimage.Pick([]byte(`not json`), "http-git-")

	require.Error(t, err)
}
