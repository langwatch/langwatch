package cmd

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/atomicfile"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// The keys `haven api --key` and `haven gateway` call with. The seeded project
// key and the personal access token come from the seed; every other key haven
// mints through the product's own routes and holds in a per-stack file (0600),
// so walkers reuse one key per name and never see any of them.

var apiKeyKinds = []string{"project", "org", "personal"}

// keyShaped matches the product's key prefixes (API, ingestion and virtual keys).
var keyShaped = regexp.MustCompile(`(sk|ik|vk)-lw-[A-Za-z0-9_-]+`)

// heldKey is one key haven minted and holds; Secret never prints.
type heldKey struct {
	Secret string `json:"secret"`
	ID     string `json:"id"`
}

// keyring resolves a key kind to a secret, minting through the stack's routes.
type keyring struct {
	api      string // the stack's API base URL
	seeded   string // HAVEN_SEED_LANGWATCH_API_KEY: local-dev-project's key
	personal string // LANGWATCH_PRIVATE_ACCESS_TOKEN: the admin's org-wide personal token
	file     string // where minted keys are held
}

// resolvedKey is a key to call with plus what `whoami` says about it.
type resolvedKey struct {
	secret    string
	minted    string // the held name, empty for a seeded key
	headers   []string
	principal string
	scope     string
}

func keyringFile(slug string) string { return filepath.Join(havenHome(), "keys", slug+".json") }

func (k keyring) load() map[string]heldKey {
	held := map[string]heldKey{}
	if data, err := os.ReadFile(k.file); err == nil {
		_ = json.Unmarshal(data, &held)
	}
	return held
}

func (k keyring) save(held map[string]heldKey) error {
	data, err := json.Marshal(held)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(k.file), 0o700); err != nil {
		return err
	}
	return atomicfile.Write(k.file, data, 0o600)
}

// forget drops a held key the stack no longer accepts (a reseed or a reset).
func (k keyring) forget(name string) error {
	held := k.load()
	delete(held, name)
	return k.save(held)
}

// secrets is every key haven knows for this stack, so output scrubs them all.
func (k keyring) secrets() []string {
	all := []string{k.seeded, k.personal}
	for _, h := range k.load() {
		all = append(all, h.Secret)
	}
	return all
}

// resolve answers kind (project|org|personal) for project ("" = the seeded one).
func (k keyring) resolve(ctx context.Context, kind, project string) (resolvedKey, error) {
	if project == domain.DefaultProjectSlug {
		project = ""
	}
	switch kind {
	case "", "project":
		if project == "" {
			if k.seeded == "" {
				return resolvedKey{}, errors.New("this stack has no seeded project key; run haven up --agent -d")
			}
			return resolvedKey{secret: k.seeded, principal: "project " + domain.DefaultProjectSlug + " (seeded project key)", scope: "project " + domain.DefaultProjectSlug}, nil
		}
		name := "project:" + project
		held, err := k.held(name, func() (heldKey, error) {
			id, err := k.projectID(ctx, project)
			if err != nil {
				return heldKey{}, err
			}
			return k.mintAPIKey(ctx, map[string]any{"name": "haven project " + project, "keyType": "service", "projectIds": []string{id}})
		})
		if err != nil {
			return resolvedKey{}, err
		}
		return resolvedKey{secret: held.Secret, minted: name, principal: "service key " + held.ID + " (acts as no member)", scope: "project " + project}, nil
	case "org":
		held, err := k.held("org", func() (heldKey, error) {
			return k.mintAPIKey(ctx, map[string]any{"name": "haven org", "keyType": "service"})
		})
		if err != nil {
			return resolvedKey{}, err
		}
		key := resolvedKey{secret: held.Secret, minted: "org", principal: "service key " + held.ID + " (acts as no member)", scope: "organization " + domain.DefaultOrganizationSlug + " (every project)"}
		return k.namingProject(ctx, key, project)
	case "personal":
		if k.personal == "" {
			return resolvedKey{}, errors.New("this stack has no seeded personal access token; run haven up --agent -d")
		}
		key := resolvedKey{secret: k.personal, principal: "the seeded admin (" + domain.DefaultAdminEmail + "), personal access token", scope: "organization " + domain.DefaultOrganizationSlug + " (ADMIN)"}
		return k.namingProject(ctx, key, project)
	}
	return resolvedKey{}, fmt.Errorf("unknown key kind %q: use one of %s", kind, strings.Join(apiKeyKinds, ", "))
}

// namingProject sends X-Project-Id so an organization-wide key acts in one project.
func (k keyring) namingProject(ctx context.Context, key resolvedKey, project string) (resolvedKey, error) {
	if project == "" {
		return key, nil
	}
	id, err := k.projectID(ctx, project)
	if err != nil {
		return resolvedKey{}, err
	}
	key.headers = []string{"X-Project-Id:" + id}
	key.scope += ", naming project " + project
	return key, nil
}

// held returns the key held under name, minting and holding it on first use.
func (k keyring) held(name string, mint func() (heldKey, error)) (heldKey, error) {
	all := k.load()
	if h, ok := all[name]; ok && h.Secret != "" {
		return h, nil
	}
	h, err := mint()
	if err != nil {
		return heldKey{}, err
	}
	all[name] = h
	return h, k.save(all)
}

// mintAPIKey creates an organization key through POST /api/api-keys, as the seeded admin.
func (k keyring) mintAPIKey(ctx context.Context, body map[string]any) (heldKey, error) {
	var minted struct {
		Token  string `json:"token"`
		APIKey struct {
			ID string `json:"id"`
		} `json:"apiKey"`
	}
	if err := k.request(ctx, http.MethodPost, k.api+"/api/api-keys", k.personal, body, &minted); err != nil {
		return heldKey{}, err
	}
	if minted.Token == "" {
		return heldKey{}, errors.New("POST /api/api-keys minted no token")
	}
	return heldKey{Secret: minted.Token, ID: minted.APIKey.ID}, nil
}

// projectID finds a project's id by slug through GET /api/projects.
func (k keyring) projectID(ctx context.Context, slug string) (string, error) {
	var page struct {
		Data []struct{ ID, Slug string }
	}
	if err := k.request(ctx, http.MethodGet, k.api+"/api/projects?limit=1000", k.personal, nil, &page); err != nil {
		return "", err
	}
	for _, p := range page.Data {
		if p.Slug == slug {
			return p.ID, nil
		}
	}
	return "", fmt.Errorf("no project %q in %s (GET /api/projects lists them)", slug, domain.DefaultOrganizationSlug)
}

// request makes one keyed call haven itself needs; an error carries no key.
func (k keyring) request(ctx context.Context, method, target, auth string, body, out any) error {
	if auth == "" {
		return errors.New("this stack has no seeded key to mint with; run haven up --agent -d")
	}
	u, err := url.Parse(target)
	if err != nil {
		return err
	}
	if _, err := localApp(u.Scheme + "://" + u.Host); err != nil {
		return err
	}
	var payload []byte
	if body != nil {
		if payload, err = json.Marshal(body); err != nil {
			return err
		}
	}
	res, err := callAPI(ctx, apiCall{
		base: u.Scheme + "://" + u.Host, key: auth, method: method, path: u.RequestURI(),
		body: payload, scrubs: k.secrets(),
	})
	if err != nil {
		return err
	}
	if res.Status/100 != 2 {
		// A failed mint may still echo a fresh key haven never held, so key shapes go too.
		return fmt.Errorf("%s %s answered %s: %s", method, u.Path, res.Line, keyShaped.ReplaceAllString(string(res.Body)+res.Text, redacted))
	}
	// The body is parsed from the raw secret-bearing bytes, never printed.
	if err := json.NewDecoder(bytes.NewReader(res.raw)).Decode(out); err != nil {
		return fmt.Errorf("%s %s: unreadable answer", method, u.Path)
	}
	return nil
}
