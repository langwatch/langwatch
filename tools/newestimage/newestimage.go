// Package newestimage picks, from `aws ecr describe-images` output, the image
// pushed last whose tag starts with a prefix, and refuses one that is not a
// multi-platform index. A release that already published an image reuses it
// (PickOrReuse), and CheckPlatforms refuses an index without a chip type. publish-docker-app.yml copies the PII redaction model
// this way: langwatch-saas pushes http-git-<sha> and a release copies the
// newest to Docker Hub.
//
// Spec: specs/ci/pii-redaction-model-release.feature
package newestimage

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// ErrNone is returned when no image has a tag with the prefix.
var ErrNone = errors.New("no image with that tag prefix")

// indexTypes are the manifest media types that hold several platforms.
var indexTypes = map[string]bool{
	"application/vnd.oci.image.index.v1+json":                   true,
	"application/vnd.docker.distribution.manifest.list.v2+json": true,
}

// Image is the one picked: its tag with the prefix, and its digest. Reused
// is true when the release already published it.
type Image struct {
	Tag    string
	Digest string
	Reused bool
}

type describeImages struct {
	ImageDetails []struct {
		ImageDigest            string    `json:"imageDigest"`
		ImageTags              []string  `json:"imageTags"`
		ImagePushedAt          time.Time `json:"imagePushedAt"`
		ImageManifestMediaType string    `json:"imageManifestMediaType"`
	} `json:"imageDetails"`
}

// Pick reads describe-images JSON and returns the image pushed last with a
// tag starting with prefix.
func Pick(data []byte, prefix string) (Image, error) {
	var out describeImages
	if err := json.Unmarshal(data, &out); err != nil {
		return Image{}, fmt.Errorf("read describe-images output: %w", err)
	}
	var best Image
	var bestAt time.Time
	var bestType string
	for _, d := range out.ImageDetails {
		tag := firstWithPrefix(d.ImageTags, prefix)
		if tag == "" || !d.ImagePushedAt.After(bestAt) {
			continue
		}
		best, bestAt, bestType = Image{Tag: tag, Digest: d.ImageDigest}, d.ImagePushedAt, d.ImageManifestMediaType
	}
	if best.Tag == "" {
		return Image{}, fmt.Errorf("%w %q", ErrNone, prefix)
	}
	if !indexTypes[bestType] {
		return Image{}, fmt.Errorf("%s is %s, not an image for several platforms", best.Tag, bestType)
	}
	if !strings.HasPrefix(best.Digest, "sha256:") {
		return Image{}, fmt.Errorf("%s has no sha256 digest (%q)", best.Tag, best.Digest)
	}

	return best, nil
}

// PickOrReuse returns the image the release already published when released
// is its digest, so a re-run never moves the version tag; otherwise it picks
// the newest image with Pick. Tag is the ECR tag with that digest, or empty
// when ECR no longer holds it.
func PickOrReuse(data []byte, prefix, released string) (Image, error) {
	if released == "" {
		return Pick(data, prefix)
	}
	if !strings.HasPrefix(released, "sha256:") {
		return Image{}, fmt.Errorf("the released digest %q is not a sha256 digest", released)
	}
	var out describeImages
	if err := json.Unmarshal(data, &out); err != nil {
		return Image{}, fmt.Errorf("read describe-images output: %w", err)
	}
	img := Image{Digest: released, Reused: true}
	for _, d := range out.ImageDetails {
		if d.ImageDigest == released {
			img.Tag = firstWithPrefix(d.ImageTags, prefix)
		}
	}

	return img, nil
}

type imageIndex struct {
	MediaType string `json:"mediaType"`
	Manifests []struct {
		Platform *struct {
			OS           string `json:"os"`
			Architecture string `json:"architecture"`
		} `json:"platform"`
	} `json:"manifests"`
}

// CheckPlatforms reads a raw image index (`docker buildx imagetools inspect
// --raw`) and fails unless it holds an image for each of want, such as
// linux/amd64. Attestation entries (unknown/unknown) count as no platform.
func CheckPlatforms(raw []byte, want ...string) error {
	var idx imageIndex
	if err := json.Unmarshal(raw, &idx); err != nil {
		return fmt.Errorf("read the image index: %w", err)
	}
	if !indexTypes[idx.MediaType] {
		return fmt.Errorf("the manifest is %q, not an image for several platforms", idx.MediaType)
	}
	have := map[string]bool{}
	for _, m := range idx.Manifests {
		if m.Platform != nil {
			have[m.Platform.OS+"/"+m.Platform.Architecture] = true
		}
	}
	var missing []string
	for _, p := range want {
		if !have[p] {
			missing = append(missing, p)
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf("the image index has no image for %s", strings.Join(missing, ", "))
	}

	return nil
}

func firstWithPrefix(tags []string, prefix string) string {
	for _, t := range tags {
		if strings.HasPrefix(t, prefix) {
			return t
		}
	}

	return ""
}

// Outputs are the GitHub output lines for the picked image.
func (i Image) Outputs() string {
	return "tag=" + i.Tag + "\ndigest=" + i.Digest + "\nreused=" + strconv.FormatBool(i.Reused) + "\n"
}
