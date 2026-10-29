package ecrtag

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"strings"
)

// acceptedMediaTypes lets batch-get-image return an image index too: its
// default answers only single manifests.
var acceptedMediaTypes = []string{
	"application/vnd.oci.image.index.v1+json",
	"application/vnd.docker.distribution.manifest.list.v2+json",
	"application/vnd.oci.image.manifest.v1+json",
	"application/vnd.docker.distribution.manifest.v2+json",
}

// Command is one command line and what it reads on stdin.
type Command struct {
	Name  string
	Args  []string
	Stdin string
}

// Exec runs a command and returns its stdout. A failure's error carries the
// command's stderr, which is where the AWS CLI names its exception.
type Exec func(ctx context.Context, c Command) (string, error)

// Run is the Exec that runs a real command.
func Run(ctx context.Context, c Command) (string, error) {
	cmd := exec.CommandContext(ctx, c.Name, c.Args...) //nolint:gosec // G204: fixed aws, docker and env command lines
	cmd.Stdin = strings.NewReader(c.Stdin)
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("%s: %w: %s", c.Name, err, strings.TrimSpace(stderr.String()))
	}

	return stdout.String(), nil
}

// CLI is the Registry behind the AWS CLI and `docker buildx imagetools`.
type CLI struct {
	// Host is the registry host, which `docker` needs to name an image.
	Host string
	Run  Exec
}

func (c CLI) aws(ctx context.Context, out any, args ...string) error {
	raw, err := c.Run(ctx, Command{Name: "aws", Args: append(append([]string{"ecr"}, args...), "--output", "json")})
	if err != nil {
		return err
	}

	return json.Unmarshal([]byte(raw), out)
}

// Describe implements Registry.
func (c CLI) Describe(ctx context.Context, ref Ref) (Image, error) {
	var fields []string
	err := c.aws(ctx, &fields, "describe-images", "--repository-name", ref.Repository, "--image-ids", "imageTag="+ref.Tag,
		"--query", "imageDetails[0].[imageDigest,imageManifestMediaType]")
	if err != nil && strings.Contains(err.Error(), "ImageNotFoundException") {
		return Image{}, ErrNotFound
	}
	if err != nil {
		return Image{}, err
	}
	if len(fields) != 2 {
		return Image{}, fmt.Errorf("describe-images answered %d fields for %s", len(fields), ref)
	}

	return Image{Digest: fields[0], MediaType: fields[1]}, nil
}

// Tags implements Registry.
func (c CLI) Tags(ctx context.Context, repository string) ([]string, error) {
	var tags []string
	err := c.aws(ctx, &tags, "describe-images", "--repository-name", repository, "--query", "imageDetails[].imageTags[]")

	return tags, err
}

// Manifest implements Registry.
func (c CLI) Manifest(ctx context.Context, ref Ref) (Manifest, error) {
	var fields []string
	args := []string{"batch-get-image", "--repository-name", ref.Repository, "--image-ids", "imageTag=" + ref.Tag,
		"--query", "images[0].[imageManifest,imageManifestMediaType]", "--accepted-media-types"}
	err := c.aws(ctx, &fields, append(args, acceptedMediaTypes...)...)
	if err != nil {
		return Manifest{}, err
	}
	if len(fields) != 2 {
		return Manifest{}, fmt.Errorf("batch-get-image returned no manifest for %s", ref)
	}

	return Manifest{Body: fields[0], MediaType: fields[1]}, nil
}

// Put implements Registry. ECR reports a tag that already names the same
// manifest as ImageAlreadyExistsException, which a re-run expects.
func (c CLI) Put(ctx context.Context, ref Ref, m Manifest) error {
	var ignored any
	err := c.aws(ctx, &ignored, "put-image", "--repository-name", ref.Repository, "--image-tag", ref.Tag,
		"--image-manifest", m.Body, "--image-manifest-media-type", m.MediaType)
	switch {
	case err == nil, strings.Contains(fmt.Sprint(err), "ImageAlreadyExistsException"):
		return nil
	case strings.Contains(err.Error(), "ImageTagAlreadyExistsException"):
		return fmt.Errorf("%w: %w", ErrTagTaken, err)
	}

	return err
}

// Label implements Registry. A tag naming an index has no single image config
// to read a label from, and is refused.
func (c CLI) Label(ctx context.Context, ref Ref, key string) (string, error) {
	raw, err := c.inspect(ctx, ref)
	if err != nil {
		return "", err
	}
	var image imageConfig
	if err := json.Unmarshal([]byte(raw), &image); err != nil {
		return "", fmt.Errorf("parse the image config of %s: %w", ref, err)
	}
	if image.Config == nil {
		return "", errors.New(ref.String() + " is not a single manifest, so it has no image config to read a label from")
	}

	return image.Config.Labels[key], nil
}

// ImageLabel implements Registry. `imagetools inspect` answers an index with
// one image per platform; an index over more than one is refused.
func (c CLI) ImageLabel(ctx context.Context, ref Ref, key string) (string, error) {
	raw, err := c.inspect(ctx, ref)
	if err != nil {
		return "", err
	}
	var image imageConfig
	if err := json.Unmarshal([]byte(raw), &image); err == nil && image.Config != nil {
		return image.Config.Labels[key], nil
	}
	var byPlatform map[string]imageConfig
	if err := json.Unmarshal([]byte(raw), &byPlatform); err != nil {
		return "", fmt.Errorf("parse the image config of %s: %w", ref, err)
	}
	if len(byPlatform) != 1 {
		return "", fmt.Errorf("%s is an index over %d images, not one", ref, len(byPlatform))
	}
	for _, one := range byPlatform {
		if one.Config == nil {
			return "", errors.New(ref.String() + " has no image config to read a label from")
		}
		return one.Config.Labels[key], nil
	}

	return "", nil
}

type imageConfig struct {
	Config *struct {
		Labels map[string]string `json:"Labels"`
	} `json:"config"`
}

func (c CLI) inspect(ctx context.Context, ref Ref) (string, error) {
	return c.Run(ctx, Command{Name: "docker", Args: []string{"buildx", "imagetools", "inspect", c.Host + "/" + ref.String(), "--format", "{{json .Image}}"}})
}

// Script is the Ancestry of .github/scripts/nearest-ancestor-tag.sh, which the
// service images' re-tag in publish-docker-ecr.yml uses too.
type Script struct {
	Path string
	Run  Exec
}

// Nearest implements Ancestry.
func (s Script) Nearest(ctx context.Context, tags []string, head string) (string, error) {
	out, err := s.Run(ctx, Command{Name: "env", Args: []string{"HEAD_COMMIT=" + head, "bash", s.Path}, Stdin: strings.Join(tags, "\n") + "\n"})

	return strings.TrimSpace(out), err
}
