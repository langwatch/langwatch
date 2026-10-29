package docsdeploy

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os/exec"
	"strings"
)

// Store is the key value store: its version, its keys, and an update made
// only against the version it was read at.
type Store interface {
	ETag(ctx context.Context) (string, error)
	List(ctx context.Context) ([]Item, error)
	Update(ctx context.Context, etag string, c Change) (string, error)
}

// Publisher brings a Store to the build's redirects and says what it
// changed on Log.
type Publisher struct {
	Store Store
	Log   io.Writer
}

// Publish makes the store hold want.
func (p Publisher) Publish(ctx context.Context, want []Item) error {
	store := p.Store
	have, err := store.List(ctx)
	if err != nil {
		return err
	}
	change := Diff(want, have)
	fmt.Fprintf(p.Log, "%d redirect keys: %d to write, %d to delete\n", len(want), len(change.Puts), len(change.Deletes))
	if len(change.Puts)+len(change.Deletes) == 0 {
		return nil
	}
	etag, err := store.ETag(ctx)
	if err != nil {
		return err
	}
	for _, batch := range change.Batches() {
		if etag, err = store.Update(ctx, etag, batch); err != nil {
			return err
		}
	}

	return nil
}

// Exec runs a command line and returns its stdout.
type Exec func(ctx context.Context, name string, args ...string) (string, error)

// Run is the Exec that runs a real command; a failure carries its stderr,
// where the AWS CLI names its exception.
func Run(ctx context.Context, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("%s: %w: %s", name, err, strings.TrimSpace(stderr.String()))
	}

	return stdout.String(), nil
}

// CLI is the Store behind `aws cloudfront-keyvaluestore`.
type CLI struct {
	ARN string
	Run Exec
}

func (c CLI) aws(ctx context.Context, out any, args ...string) error {
	full := append(append([]string{"cloudfront-keyvaluestore"}, args...), "--kvs-arn", c.ARN, "--output", "json")
	raw, err := c.Run(ctx, "aws", full...)
	if err != nil {
		return err
	}

	return json.Unmarshal([]byte(raw), out)
}

// ETag is the store's current version, which an update must name.
func (c CLI) ETag(ctx context.Context) (string, error) {
	var out struct{ ETag string }
	err := c.aws(ctx, &out, "describe-key-value-store")

	return out.ETag, err
}

// List reads every key, page by page.
func (c CLI) List(ctx context.Context) ([]Item, error) {
	items := []Item{}
	token := ""
	for {
		args := []string{"list-keys"}
		if token != "" {
			args = append(args, "--next-token", token)
		}
		var page struct {
			Items     []Item
			NextToken string
		}
		if err := c.aws(ctx, &page, args...); err != nil {
			return nil, err
		}
		items = append(items, page.Items...)
		if token = page.NextToken; token == "" {
			return items, nil
		}
	}
}

// Update applies one batch against etag and returns the new version.
func (c CLI) Update(ctx context.Context, etag string, ch Change) (string, error) {
	args := []string{"update-keys", "--if-match", etag}
	if len(ch.Puts) > 0 {
		puts, err := json.Marshal(ch.Puts)
		if err != nil {
			return "", err
		}
		args = append(args, "--puts", string(puts))
	}
	if len(ch.Deletes) > 0 {
		deletes := make([]map[string]string, 0, len(ch.Deletes))
		for _, key := range ch.Deletes {
			deletes = append(deletes, map[string]string{"Key": key})
		}
		raw, err := json.Marshal(deletes)
		if err != nil {
			return "", err
		}
		args = append(args, "--deletes", string(raw))
	}
	var out struct{ ETag string }
	err := c.aws(ctx, &out, args...)

	return out.ETag, err
}
