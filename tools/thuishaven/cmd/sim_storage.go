package cmd

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer/sources"
)

const storageUsage = "usage: haven storage <buckets|objects [bucket]|object <bucket> <key> [--raw]|requests> [--json]"

type storageObject struct {
	Bucket       string    `json:"bucket"`
	Key          string    `json:"key"`
	Size         int64     `json:"size"`
	ContentType  string    `json:"contentType"`
	LastModified time.Time `json:"lastModified"`
}

// runStorage is `haven storage <buckets|objects|object|requests>`.
func runStorage(_ context.Context, d deps, inv invocation) error {
	if len(inv.args) == 0 {
		return errors.New(storageUsage)
	}
	api, err := simAPI(d, inv, "storage")
	if err != nil {
		return err
	}
	return storageCommand(api, inv, inv.has("--json") || d.isAgent)
}

func storageCommand(api sources.SimAPI, inv invocation, asJSON bool) error {
	switch inv.args[0] {
	case "buckets":
		return simGet(api, "/_sim/api/buckets", nil, asJSON, func(v struct {
			Buckets []struct {
				Name    string
				Objects int
				Size    int64
			}
		}) {
			for _, b := range v.Buckets {
				fmt.Printf("%-32s %6d objects %10d bytes\n", b.Name, b.Objects, b.Size)
			}
		})
	case "objects":
		params := url.Values{}
		if len(inv.args) > 1 {
			params.Set("bucket", inv.args[1])
		}
		return simGet(api, "/_sim/api/objects", params, asJSON, func(v struct{ Objects []storageObject }) {
			for _, o := range v.Objects {
				fmt.Printf("%-24s %-48s %10d %-24s %s\n", o.Bucket, o.Key, o.Size, o.ContentType, o.LastModified.Format(time.RFC3339))
			}
		})
	case "object":
		return storageObjectCommand(api, inv, asJSON)
	case "requests":
		return simGet(api, "/_sim/api/requests", nil, asJSON, func(v struct{ Requests []map[string]any }) {
			for _, r := range v.Requests {
				fmt.Println(r)
			}
		})
	}
	return fmt.Errorf("unknown `haven storage` subcommand %q; %s", inv.args[0], storageUsage)
}

// storageObjectCommand shows one object's metadata, or with --raw its bytes.
func storageObjectCommand(api sources.SimAPI, inv invocation, asJSON bool) error {
	if err := needArgs(inv, 3, "haven storage object <bucket> <key> [--raw]"); err != nil {
		return err
	}
	params := url.Values{"bucket": {inv.args[1]}, "key": {inv.args[2]}}
	if inv.has("--raw") {
		body, err := api.GetRaw("/_sim/api/object/raw", params)
		if err != nil {
			return err
		}
		_, err = os.Stdout.Write(body)
		return err
	}
	return simGet(api, "/_sim/api/object", params, asJSON, func(v struct {
		storageObject
		Headers map[string]string `json:"headers"`
	}) {
		fmt.Printf("%s/%s\n%d bytes, %s, modified %s\n", v.Bucket, v.Key, v.Size, v.ContentType, v.LastModified.Format(time.RFC3339))
		for k, val := range v.Headers {
			fmt.Printf("  %s: %s\n", k, val)
		}
	})
}
