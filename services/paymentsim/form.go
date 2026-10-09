package paymentsim

import (
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
)

// params is a Stripe request decoded from its bracket form (items[0][price]=x,
// expand[]=y, metadata[k]=v) into nested maps; a map whose keys are all indexes
// reads as a list.
type params map[string]any

// maxForm bounds one request body.
const maxForm = 1 << 20

// readParams merges the query string and a form body, as Stripe reads both.
func readParams(w http.ResponseWriter, r *http.Request) (params, []byte, error) {
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxForm))
	if err != nil {
		return nil, nil, err
	}
	values, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		return nil, nil, err
	}
	body, err := url.ParseQuery(string(raw))
	if err != nil {
		return nil, nil, err
	}
	for k, v := range body {
		values[k] = append(values[k], v...)
	}
	p := params{}
	keys := make([]string, 0, len(values))
	for k := range values {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		for _, v := range values[k] {
			p.put(splitKey(k), v)
		}
	}
	return p, raw, nil
}

// splitKey turns items[0][price] into [items 0 price]; [] is an empty segment.
func splitKey(key string) []string {
	head, rest, found := strings.Cut(key, "[")
	if !found {
		return []string{key}
	}
	parts := []string{head}
	for _, seg := range strings.Split(strings.TrimSuffix(rest, "]"), "][") {
		parts = append(parts, seg)
	}
	return parts
}

func (p params) put(path []string, value string) {
	at := p
	for i, seg := range path {
		if seg == "" {
			seg = strconv.Itoa(len(at))
		}
		if i == len(path)-1 {
			at[seg] = value
			return
		}
		next, ok := at[seg].(params)
		if !ok {
			next = params{}
			at[seg] = next
		}
		at = next
	}
}

func (p params) has(key string) bool { _, ok := p[key]; return ok }

func (p params) str(key string) string { s, _ := p[key].(string); return s }

func (p params) sub(key string) params { m, _ := p[key].(params); return m }

func (p params) integer(key string) (int64, bool) {
	n, err := strconv.ParseInt(p.str(key), 10, 64)
	return n, err == nil
}

func (p params) boolean(key string) bool { return p.str(key) == "true" }

// list reads an indexed map as its entries in index order.
func (p params) list(key string) []any {
	m := p.sub(key)
	idx := make([]int, 0, len(m))
	for k := range m {
		n, err := strconv.Atoi(k)
		if err != nil {
			return nil
		}
		idx = append(idx, n)
	}
	sort.Ints(idx)
	out := make([]any, 0, len(idx))
	for _, n := range idx {
		out = append(out, m[strconv.Itoa(n)])
	}
	return out
}

func (p params) strings(key string) []string {
	var out []string
	for _, v := range p.list(key) {
		if s, ok := v.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

func (p params) objects(key string) []params {
	var out []params
	for _, v := range p.list(key) {
		if m, ok := v.(params); ok {
			out = append(out, m)
		}
	}
	return out
}

// metadata reads metadata[k]=v; Stripe treats an empty value as "unset k".
func (p params) metadata() map[string]string {
	out := map[string]string{}
	for k, v := range p.sub("metadata") {
		if s, ok := v.(string); ok && s != "" {
			out[k] = s
		}
	}
	return out
}

func (p params) expands(path string) bool {
	for _, e := range p.strings("expand") {
		if e == path {
			return true
		}
	}
	return false
}
