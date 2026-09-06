package domain

import (
	"encoding/json"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

// The classification of an environment variable is data, and packages/secrets
// owns it. haven reads that same file rather than carrying a second list, so a
// key added in TypeScript is masked here without a Go change.

// SecretRegistryPath is where the classification lives, relative to a checkout.
const SecretRegistryPath = "packages/secrets/keys.json"

// SecretClass is the class one environment variable falls into.
type SecretClass string

const (
	// ClassSecret is a rotating credential: never printed without --reveal.
	ClassSecret SecretClass = "secret"
	// ClassComposite carries shape and credential in one string.
	ClassComposite SecretClass = "composite"
	// ClassConfig is everything else and prints verbatim.
	ClassConfig SecretClass = "config"
)

// MaskedSecret is what a secret's value reads as without --reveal.
const MaskedSecret = "<secret:masked>"

type secretRegistryFile struct {
	Keys []struct {
		Key   string `json:"key"`
		Class string `json:"class"`
	} `json:"keys"`
}

// SecretClasses loads the classification from the checkout at repoRoot.
//
// A registry that cannot be read is not a license to print: the caller falls
// back to NameLooksSecret, which masks on the key's shape alone.
func SecretClasses(repoRoot string) map[string]SecretClass {
	raw, err := os.ReadFile(filepath.Join(repoRoot, SecretRegistryPath))
	if err != nil {
		return nil
	}
	var parsed secretRegistryFile
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil
	}
	classes := make(map[string]SecretClass, len(parsed.Keys))
	for _, entry := range parsed.Keys {
		switch SecretClass(entry.Class) {
		case ClassSecret:
			classes[entry.Key] = ClassSecret
		case ClassComposite:
			classes[entry.Key] = ClassComposite
		case ClassConfig:
		}
	}
	return classes
}

// NameLooksSecret is the fallback when no registry could be read: the key-name
// shapes that are a credential in every deployment we have ever shipped.
func NameLooksSecret(key string) bool {
	suffixes := []string{"_SECRET", "_API_KEY", "_PASSWORD", "_TOKEN", "_PRIVATE_KEY", "_PEPPER"}
	for _, suffix := range suffixes {
		if strings.HasSuffix(key, suffix) {
			return true
		}
	}
	return false
}

// ClassOf answers the class of one key against a loaded registry, falling back
// to the name shapes when the registry is absent.
func ClassOf(classes map[string]SecretClass, key string) SecretClass {
	if classes == nil {
		if NameLooksSecret(key) {
			return ClassSecret
		}
		return ClassConfig
	}
	if class, ok := classes[key]; ok {
		return class
	}
	return ClassConfig
}

// MaskEnvValue renders one value for an ordinary reader: a secret becomes the
// marker, a composite keeps scheme, host, port and path and loses its userinfo
// and query, and configuration passes through.
func MaskEnvValue(classes map[string]SecretClass, key, value string) string {
	switch ClassOf(classes, key) {
	case ClassSecret:
		return MaskedSecret
	case ClassComposite:
		return maskCompositeValue(value)
	default:
		return value
	}
}

func maskCompositeValue(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return trimmed
	}
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Host == "" {
		return MaskedSecret
	}
	parsed.User = nil
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String()
}
