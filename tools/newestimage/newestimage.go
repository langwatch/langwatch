// Package newestimage picks, from `aws ecr describe-images` output, the image
// pushed last whose tag starts with a prefix, and refuses one that is not a
// multi-platform index. publish-docker-app.yml copies the PII redaction model
// this way: langwatch-saas pushes http-git-<sha> and a release copies the
// newest to Docker Hub.
//
// Spec: specs/ci/pii-redaction-model-release.feature
package newestimage

import (
	"encoding/json"
	"errors"
	"fmt"
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

// Image is the one picked: its tag with the prefix, and its digest.
type Image struct {
	Tag    string
	Digest string
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
	return "tag=" + i.Tag + "\ndigest=" + i.Digest + "\n"
}
