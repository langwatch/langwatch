package httpblock

import (
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

// ErrCrossOriginRedirect is returned instead of following a redirect that
// would carry the request's credentials to another scheme, host or port.
var ErrCrossOriginRedirect = errors.New("redirect to a different address refused: credentials are only sent to the original address")

const maxRedirects = 10

var defaultPorts = map[string]string{"http": "80", "https": "443"}

func originOf(u *url.URL) (scheme, host, port string) {
	scheme = strings.ToLower(u.Scheme)
	port = u.Port()
	if port == "" {
		port = defaultPorts[scheme]
	}
	return scheme, strings.ToLower(u.Hostname()), port
}

func sameOrigin(a, b *url.URL) bool {
	aScheme, aHost, aPort := originOf(a)
	bScheme, bHost, bPort := originOf(b)
	return aScheme == bScheme && aHost == bHost && aPort == bPort
}

// carriesCredentials reports whether a request sends anything a redirect
// target must not receive: an auth config or any header beyond trace context.
func carriesCredentials(req Request) bool {
	if req.Auth != nil {
		return true
	}
	for name := range req.Headers {
		switch strings.ToLower(name) {
		case "traceparent", "tracestate":
		default:
			return true
		}
	}
	return false
}

// credentialQueryParam matches a query parameter name that carries a credential.
var credentialQueryParam = regexp.MustCompile(`(?i)key|token|secret|auth|passw|sig|credential`)

// urlCarriesCredentials reports whether the address itself holds a credential:
// userinfo, or a query parameter named like one.
func urlCarriesCredentials(u *url.URL) bool {
	if u.User != nil {
		return true
	}
	for name := range u.Query() {
		if credentialQueryParam.MatchString(name) {
			return true
		}
	}
	return false
}

func followPrior(prior func(*http.Request, []*http.Request) error, req *http.Request, via []*http.Request) error {
	if prior != nil {
		return prior(req, via)
	}
	if len(via) >= maxRedirects {
		return errors.New("stopped after 10 redirects")
	}
	return nil
}

// clientFollowingSameOrigin copies client so redirects are followed only
// within the original request's origin. The caller's own policy still applies.
func clientFollowingSameOrigin(client *http.Client) *http.Client {
	scoped := *client
	prior := client.CheckRedirect
	scoped.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if !sameOrigin(via[0].URL, req.URL) {
			return ErrCrossOriginRedirect
		}
		return followPrior(prior, req, via)
	}
	return &scoped
}

// clientDroppingCrossOriginReferer copies client so a redirect to another
// origin does not receive the previous address, query included, as Referer.
func clientDroppingCrossOriginReferer(client *http.Client) *http.Client {
	scoped := *client
	prior := client.CheckRedirect
	scoped.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if !sameOrigin(via[0].URL, req.URL) {
			req.Header.Del("Referer")
		}
		return followPrior(prior, req, via)
	}
	return &scoped
}
