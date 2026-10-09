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

const storageUsage = "usage: haven storage <buckets|objects [bucket]|object <bucket> <key> [--raw]|presign <bucket> <key> [--put] [--expires=<s>]|delete <bucket> <key>|clear [bucket]|seed|requests> [--json]"

type storageObject struct {
	Bucket       string    `json:"bucket"`
	Key          string    `json:"key"`
	Size         int64     `json:"size"`
	ContentType  string    `json:"contentType"`
	LastModified time.Time `json:"lastModified"`
}

type storageRequest struct {
	Method    string    `json:"method"`
	Bucket    string    `json:"bucket"`
	Key       string    `json:"key"`
	Status    int       `json:"status"`
	At        time.Time `json:"at"`
	Auth      string    `json:"auth"`
	RequestID string    `json:"requestId"`
}

// runStorage is `haven storage <buckets|objects|object|delete|clear|requests>`.
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
	case "delete":
		return storageDelete(api, inv, asJSON)
	case "clear":
		return storageClear(api, inv, asJSON)
	case "presign":
		return storagePresign(api, inv, asJSON)
	case "seed":
		return storageSeed(api, asJSON)
	case "requests":
		return simGet(api, "/_sim/api/requests", nil, asJSON, func(v struct{ Requests []storageRequest }) {
			for _, r := range v.Requests {
				fmt.Printf("%s %-6s %3d %-9s %s /%s/%s\n", r.At.Format(time.RFC3339), r.Method, r.Status, r.Auth, r.RequestID, r.Bucket, r.Key)
			}
		})
	}
	return fmt.Errorf("unknown `haven storage` subcommand %q; %s", inv.args[0], storageUsage)
}

// storagePresign mints a presigned GET (or with --put a PUT) URL for one object.
func storagePresign(api sources.SimAPI, inv invocation, asJSON bool) error {
	if err := needArgs(inv, 3, "haven storage presign <bucket> <key> [--put] [--expires=<seconds>]"); err != nil {
		return err
	}
	params := url.Values{"bucket": {inv.args[1]}, "key": {inv.args[2]}}
	if inv.has("--put") {
		params.Set("method", "PUT")
	}
	if expires := inv.value("--expires"); expires != "" {
		params.Set("expires", expires)
	}
	return simGet(api, "/_sim/api/presign", params, asJSON, func(v struct {
		URL       string    `json:"url"`
		Method    string    `json:"method"`
		ExpiresAt time.Time `json:"expiresAt"`
	}) {
		fmt.Printf("%s %s\n(expires %s)\n", v.Method, v.URL, v.ExpiresAt.Format(time.RFC3339))
	})
}

// storageSeed writes the demo objects, leaving any that already exist.
func storageSeed(api sources.SimAPI, asJSON bool) error {
	if err := api.Post("/_sim/api/seed", nil, nil); err != nil {
		return err
	}
	return simDone(asJSON, "seeded", "seeded the demo objects into bucket langwatch")
}

// storageDelete removes one object.
func storageDelete(api sources.SimAPI, inv invocation, asJSON bool) error {
	if err := needArgs(inv, 3, "haven storage delete <bucket> <key>"); err != nil {
		return err
	}
	params := url.Values{"bucket": {inv.args[1]}, "key": {inv.args[2]}}
	if err := api.Delete("/_sim/api/object?" + params.Encode()); err != nil {
		return err
	}
	return simDone(asJSON, "deleted", "deleted "+inv.args[1]+"/"+inv.args[2])
}

// storageClear removes every object in one bucket, or in all of them.
func storageClear(api sources.SimAPI, inv invocation, asJSON bool) error {
	target, scope := "/_sim/api/objects", "every bucket"
	if len(inv.args) > 1 {
		target += "?" + url.Values{"bucket": {inv.args[1]}}.Encode()
		scope = inv.args[1]
	}
	if err := api.Delete(target); err != nil {
		return err
	}
	return simDone(asJSON, "cleared", "cleared "+scope)
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
