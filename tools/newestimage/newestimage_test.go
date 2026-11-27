package newestimage_test

import (
	"fmt"
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
	assert.Equal(t, "tag=http-git-bbbbbbb\ndigest=sha256:new\nreused=false\n", got.Outputs())
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

// @scenario "A re-run keeps the image the release already published"
func TestReusesTheDigestTheReleaseAlreadyPublished(t *testing.T) {
	data := []byte(`{"imageDetails": [
	  {"imageDigest": "sha256:first", "imageTags": ["http-git-aaaaaaa"], "imagePushedAt": "2026-11-01T10:00:00Z", "imageManifestMediaType": "` + index + `"},
	  {"imageDigest": "sha256:newer", "imageTags": ["http-git-bbbbbbb"], "imagePushedAt": "2026-11-02T10:00:00Z", "imageManifestMediaType": "` + index + `"}
	]}`)

	got, err := newestimage.PickOrReuse(data, "http-git-", "sha256:first")

	require.NoError(t, err)
	assert.Equal(t, newestimage.Image{Tag: "http-git-aaaaaaa", Digest: "sha256:first", Reused: true}, got)
	assert.Equal(t, "tag=http-git-aaaaaaa\ndigest=sha256:first\nreused=true\n", got.Outputs())
}

// @scenario "A re-run keeps the image the release already published"
func TestReusesAReleasedDigestECRNoLongerHolds(t *testing.T) {
	got, err := newestimage.PickOrReuse([]byte(`{"imageDetails": []}`), "http-git-", "sha256:gone")

	require.NoError(t, err)
	assert.Equal(t, newestimage.Image{Digest: "sha256:gone", Reused: true}, got)
}

// @scenario "A re-run keeps the image the release already published"
func TestPicksFreshWhenNothingIsReleased(t *testing.T) {
	data := []byte(`{"imageDetails": [
	  {"imageDigest": "sha256:newer", "imageTags": ["http-git-bbbbbbb"], "imagePushedAt": "2026-11-02T10:00:00Z", "imageManifestMediaType": "` + index + `"}
	]}`)

	got, err := newestimage.PickOrReuse(data, "http-git-", "")

	require.NoError(t, err)
	assert.Equal(t, newestimage.Image{Tag: "http-git-bbbbbbb", Digest: "sha256:newer"}, got)
	assert.Equal(t, "tag=http-git-bbbbbbb\ndigest=sha256:newer\nreused=false\n", got.Outputs())
}

func TestRefusesAReleasedDigestThatIsNotSha256(t *testing.T) {
	_, err := newestimage.PickOrReuse([]byte(`{"imageDetails": []}`), "http-git-", "latest")

	require.Error(t, err)
}

const rawIndex = `{"schemaVersion": 2, "mediaType": "application/vnd.oci.image.index.v1+json", "manifests": [%s]}`

func entry(os, arch string) string {
	return `{"mediaType": "application/vnd.oci.image.manifest.v1+json", "digest": "sha256:x", "size": 1, "platform": {"os": "` + os + `", "architecture": "` + arch + `"}}`
}

// @scenario "An index without both chip types is refused"
func TestAcceptsAnIndexWithBothChipTypes(t *testing.T) {
	raw := fmt.Sprintf(rawIndex, entry("linux", "amd64")+","+entry("linux", "arm64")+","+entry("unknown", "unknown"))

	require.NoError(t, newestimage.CheckPlatforms([]byte(raw), "linux/amd64", "linux/arm64"))
}

// @scenario "An index without both chip types is refused"
func TestRefusesAnIndexMissingAChipType(t *testing.T) {
	raw := fmt.Sprintf(rawIndex, entry("linux", "arm64")+","+entry("unknown", "unknown"))

	err := newestimage.CheckPlatforms([]byte(raw), "linux/amd64", "linux/arm64")

	require.Error(t, err)
	assert.Contains(t, err.Error(), "linux/amd64")
	assert.NotContains(t, err.Error(), "linux/arm64,")
}

// @scenario "An index without both chip types is refused"
func TestRefusesAManifestThatIsNotAnIndex(t *testing.T) {
	raw := `{"schemaVersion": 2, "mediaType": "application/vnd.oci.image.manifest.v1+json", "config": {}, "layers": []}`

	require.Error(t, newestimage.CheckPlatforms([]byte(raw), "linux/amd64", "linux/arm64"))
}
