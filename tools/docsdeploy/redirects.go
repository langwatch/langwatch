// Package docsdeploy publishes the docs build's redirects.json into the
// CloudFront key value store the docs distribution's viewer-request function
// reads (langwatch-saas infrastructure/cloudfront-functions/
// docs-site-viewer-request.js): one key per exact source, and every ":param"
// source as one JSON list of [source, destination] pairs under PatternsKey,
// in file order.
//
// Spec: specs/ci/docs-deploy.feature
package docsdeploy

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
)

// PatternsKey holds the pattern sources, which the function tries in order.
const PatternsKey = "__patterns"

// The key value store's limits: a key of 512 bytes, a value of 1 KB, and 50
// keys written or deleted in one update.
const (
	maxKey   = 512
	maxValue = 1024
	maxBatch = 50
)

// Item is one key and its value in the store.
type Item struct {
	Key   string `json:"Key"`
	Value string `json:"Value"`
}

// Items turns redirects.json into the store's contents, keeping the file's
// order, which decides which pattern wins.
func Items(raw []byte) ([]Item, error) {
	pairs, err := orderedPairs(raw)
	if err != nil {
		return nil, err
	}
	items := []Item{}
	patterns := [][2]string{}
	for _, p := range pairs {
		if strings.Contains(p[0], ":") {
			patterns = append(patterns, p)
			continue
		}
		items = append(items, Item{Key: p[0], Value: p[1]})
	}
	listed, err := json.Marshal(patterns)
	if err != nil {
		return nil, err
	}
	items = append(items, Item{Key: PatternsKey, Value: string(listed)})

	return items, checkLimits(items)
}

// orderedPairs reads a flat JSON object of strings as [key, value] pairs in
// file order; a map would lose the order.
func orderedPairs(raw []byte) ([][2]string, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	if tok, err := dec.Token(); err != nil || tok != json.Delim('{') {
		return nil, errors.New("redirects.json is not a JSON object")
	}
	pairs := [][2]string{}
	for dec.More() {
		var key, value string
		if err := decodeString(dec, &key); err != nil {
			return nil, err
		}
		if err := dec.Decode(&value); err != nil {
			return nil, fmt.Errorf("redirects.json: %q: the destination is not a string: %w", key, err)
		}
		pairs = append(pairs, [2]string{key, value})
	}

	return pairs, nil
}

func decodeString(dec *json.Decoder, into *string) error {
	tok, err := dec.Token()
	if err != nil {
		return fmt.Errorf("redirects.json: %w", err)
	}
	s, ok := tok.(string)
	if !ok {
		return errors.New("redirects.json: a key is not a string")
	}
	*into = s

	return nil
}

func checkLimits(items []Item) error {
	for _, it := range items {
		if len(it.Key) > maxKey || len(it.Value) > maxValue {
			return fmt.Errorf("redirect %q does not fit the key value store (key %d of %d bytes, value %d of %d)",
				it.Key, len(it.Key), maxKey, len(it.Value), maxValue)
		}
	}

	return nil
}

// Change is what one update writes and deletes.
type Change struct {
	Puts    []Item
	Deletes []string
}

// Diff is what turns have into want: the keys whose value is new or changed,
// and the keys want no longer has.
func Diff(want, have []Item) Change {
	current := make(map[string]string, len(have))
	for _, it := range have {
		current[it.Key] = it.Value
	}
	c := Change{}
	wanted := make(map[string]bool, len(want))
	for _, it := range want {
		wanted[it.Key] = true
		if v, ok := current[it.Key]; !ok || v != it.Value {
			c.Puts = append(c.Puts, it)
		}
	}
	for _, it := range have {
		if !wanted[it.Key] {
			c.Deletes = append(c.Deletes, it.Key)
		}
	}
	slices.Sort(c.Deletes)

	return c
}

// Batches splits a change into updates of at most 50 keys: every write
// first, so no key the function looks up is missing mid-deploy, then the
// deletes.
func (c Change) Batches() []Change {
	out := []Change{}
	for start := 0; start < len(c.Puts); start += maxBatch {
		out = append(out, Change{Puts: c.Puts[start:min(start+maxBatch, len(c.Puts))]})
	}
	for start := 0; start < len(c.Deletes); start += maxBatch {
		out = append(out, Change{Deletes: c.Deletes[start:min(start+maxBatch, len(c.Deletes))]})
	}

	return out
}
