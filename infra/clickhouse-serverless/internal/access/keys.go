package access

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	jose "github.com/go-jose/go-jose/v4"
)

const (
	// KeyRefreshInterval re-reads an issuer's keys even when every kid is known.
	KeyRefreshInterval = 15 * time.Minute
	// KeyRefetchMinInterval bounds the refetches an unknown kid can cause, so
	// forged key ids cannot hammer the issuer.
	KeyRefetchMinInterval = 30 * time.Second
	fetchTimeout          = 4 * time.Second // below ClickHouse's 5 s receive timeout
	maxDocumentBytes      = 1 << 20
)

var errUnknownKey = errors.New("no key of the issuer matches the token's key id")

// keySource holds one issuer's signing keys: fetched via OIDC discovery (or
// jwks_url), re-read every KeyRefreshInterval, kept when a re-read fails.
type keySource struct {
	issuer Issuer
	client *http.Client

	mu          sync.Mutex
	keys        *jose.JSONWebKeySet
	fetchedAt   time.Time
	lastAttempt time.Time
}

func newKeySource(is Issuer) *keySource {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if is.CAPool != nil {
		transport.TLSClientConfig = &tls.Config{RootCAs: is.CAPool, MinVersion: tls.VersionTLS12}
	}
	return &keySource{
		issuer: is,
		client: &http.Client{
			Timeout:   fetchTimeout,
			Transport: transport,
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				if len(via) >= 3 {
					return errors.New("too many redirects")
				}
				return checkEndpoint(req.URL.String())
			},
		},
	}
}

// key returns the verification key for kid, refetching the key set when the
// kid is unknown or the set is stale, at most once per KeyRefetchMinInterval.
func (k *keySource) key(ctx context.Context, kid string, now time.Time) (*jose.JSONWebKey, error) {
	k.mu.Lock()
	defer k.mu.Unlock()
	if k.keys != nil && now.Sub(k.fetchedAt) < KeyRefreshInterval {
		if key, ok := pick(k.keys, kid); ok {
			return key, nil
		}
	}
	if !k.lastAttempt.IsZero() && now.Sub(k.lastAttempt) < KeyRefetchMinInterval {
		if key, ok := pick(k.keys, kid); ok {
			return key, nil
		}
		return nil, errUnknownKey
	}
	k.lastAttempt = now
	keys, err := k.fetch(ctx)
	if err != nil {
		// Keep serving the keys we have; the issuer may only be briefly unreachable.
		if key, ok := pick(k.keys, kid); ok {
			return key, nil
		}
		return nil, err
	}
	k.keys, k.fetchedAt = keys, now
	if key, ok := pick(k.keys, kid); ok {
		return key, nil
	}
	return nil, errUnknownKey
}

// pick finds the signing key for kid. A token without a kid is accepted only
// when the set holds exactly one signing key.
func pick(set *jose.JSONWebKeySet, kid string) (*jose.JSONWebKey, bool) {
	if set == nil {
		return nil, false
	}
	var signing []jose.JSONWebKey
	for _, key := range set.Keys {
		if (key.Use == "" || key.Use == "sig") && key.Valid() && key.IsPublic() {
			signing = append(signing, key)
		}
	}
	if kid == "" {
		if len(signing) == 1 {
			return &signing[0], true
		}
		return nil, false
	}
	for i := range signing {
		if signing[i].KeyID == kid {
			return &signing[i], true
		}
	}
	return nil, false
}

func (k *keySource) fetch(ctx context.Context) (*jose.JSONWebKeySet, error) {
	jwksURL := k.issuer.JWKSURL
	if jwksURL == "" {
		var discovery struct {
			Issuer  string `json:"issuer"`
			JWKSURI string `json:"jwks_uri"`
		}
		url := strings.TrimSuffix(k.issuer.URL, "/") + "/.well-known/openid-configuration"
		if err := k.getJSON(ctx, url, &discovery); err != nil {
			return nil, fmt.Errorf("issuer %q discovery: %w", k.issuer.Name, err)
		}
		if discovery.Issuer != k.issuer.URL {
			return nil, fmt.Errorf("issuer %q discovery names issuer %q, want %q", k.issuer.Name, discovery.Issuer, k.issuer.URL)
		}
		if err := checkEndpoint(discovery.JWKSURI); err != nil {
			return nil, fmt.Errorf("issuer %q jwks_uri: %w", k.issuer.Name, err)
		}
		jwksURL = discovery.JWKSURI
	}
	var set jose.JSONWebKeySet
	if err := k.getJSON(ctx, jwksURL, &set); err != nil {
		return nil, fmt.Errorf("issuer %q keys: %w", k.issuer.Name, err)
	}
	return &set, nil
}

func (k *keySource) getJSON(ctx context.Context, url string, dst any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	resp, err := k.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("GET %s: %s", url, resp.Status)
	}
	return json.NewDecoder(io.LimitReader(resp.Body, maxDocumentBytes)).Decode(dst)
}

func (k *keySource) hasKeys() bool {
	k.mu.Lock()
	defer k.mu.Unlock()
	return k.keys != nil
}

// warm fetches the keys once if none are held, so the first login does not
// wait for discovery. A failure is left for the first login to retry.
func (k *keySource) warm(ctx context.Context, now time.Time) error {
	k.mu.Lock()
	defer k.mu.Unlock()
	if k.keys != nil {
		return nil
	}
	keys, err := k.fetch(ctx)
	if err != nil {
		return err
	}
	k.keys, k.fetchedAt = keys, now
	return nil
}
