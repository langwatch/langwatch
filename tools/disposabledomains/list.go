// Package disposabledomains builds the checked-in list of disposable email
// domains the organization module's sign-up policy refuses, and the record of
// the upstream commit it was read at, so a refresh can be reproduced.
package disposabledomains

import (
	"bytes"
	"encoding/json"
	"fmt"
	"regexp"
	"slices"
	"strings"
)

// MinimumDomains guards a refresh: a list that shrinks this far is more likely
// a broken download than an upstream clean-up.
const MinimumDomains = 5_000

var domainShape = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$`)

// Source names where a generated list came from.
type Source struct {
	Repository string `json:"repository"`
	File       string `json:"file"`
	Commit     string `json:"commit"`
	Domains    int    `json:"domains"`
}

// ParseList reads the upstream blocklist: one domain per line, `#` comments,
// any case. It returns the domains lowercased, deduplicated and sorted.
func ParseList(text string, minimum int) ([]string, error) {
	seen := map[string]bool{}
	var domains, malformed []string
	for _, line := range strings.Split(text, "\n") {
		domain := strings.ToLower(strings.TrimSpace(line))
		if domain == "" || strings.HasPrefix(domain, "#") || seen[domain] {
			continue
		}
		seen[domain] = true
		if !domainShape.MatchString(domain) {
			malformed = append(malformed, domain)
		}
		domains = append(domains, domain)
	}
	if len(malformed) > 0 {
		return nil, fmt.Errorf("malformed domains: %s", strings.Join(malformed, ", "))
	}
	if len(domains) < minimum {
		return nil, fmt.Errorf("only %d domains downloaded; refusing to write the list", len(domains))
	}
	slices.Sort(domains)
	return domains, nil
}

// RenderJSON writes a value as two-space indented JSON with a trailing newline,
// the shape oxfmt leaves a JSON file in.
func RenderJSON(value any) ([]byte, error) {
	var out bytes.Buffer
	encoder := json.NewEncoder(&out)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(value); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}
