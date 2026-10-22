package access

import (
	"bytes"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"net"
	"net/netip"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"gopkg.in/yaml.v3"
)

// File is access.yaml: the issuers token users trust and the users the image
// renders. Load decodes it strictly and validates it.
type File struct {
	Issuers []Issuer `yaml:"issuers"`
	Users   []User   `yaml:"users"`

	// Raw is the file's content, so a caller can tell when it changed.
	Raw []byte `yaml:"-"`
}

// Issuer is an OIDC provider whose JWTs log token users in.
type Issuer struct {
	Name           string         `yaml:"name"`
	URL            string         `yaml:"url"`
	Audience       string         `yaml:"audience"`
	UsernameClaim  string         `yaml:"username_claim"`
	RequiredClaims map[string]any `yaml:"required_claims"`
	JWKSURL        string         `yaml:"jwks_url"`
	CAFile         string         `yaml:"ca_file"`
	AllowAdmin     bool           `yaml:"allow_admin"`

	// CAPool holds ca_file's certificates, read by Load.
	CAPool *x509.CertPool `yaml:"-"`
}

// User is one login: a tier, where it applies, and how the user proves who it is.
type User struct {
	Name      string   `yaml:"name"`
	Tier      Tier     `yaml:"tier"`
	Databases []string `yaml:"databases"`
	Networks  []string `yaml:"networks"`
	Login     Login    `yaml:"login"`
}

// Login holds exactly one login kind.
type Login struct {
	Rolling *RollingLogin `yaml:"rolling"`
	Token   *TokenLogin   `yaml:"token"`
}

// RollingLogin reads every password file in Dir (see ReadPasswordDir).
type RollingLogin struct {
	Dir string `yaml:"dir"`
}

// TokenLogin accepts a JWT from Issuer whose username claim equals Subject.
type TokenLogin struct {
	Issuer  string `yaml:"issuer"`
	Subject string `yaml:"subject"`
}

const (
	DefaultAudience      = "clickhouse"
	DefaultUsernameClaim = "sub"
	anyNetwork           = "::/0"
)

var (
	issuerNameRE = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,62}$`)
	// No dot: ClickHouse config paths split on it.
	userNameRE     = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_-]{0,62}$`)
	databaseNameRE = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]{0,205}$`)
	// A read grant on these would open query text and other users' metadata.
	forbiddenDatabases = map[string]bool{"system": true, "information_schema": true, "INFORMATION_SCHEMA": true}
)

// Load reads and validates the access file at path.
func Load(path string) (*File, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	f, err := Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	for i := range f.Issuers {
		if err := f.Issuers[i].loadCA(); err != nil {
			return nil, fmt.Errorf("%s: issuers %q: %w", path, f.Issuers[i].Name, err)
		}
	}
	return f, nil
}

// Parse decodes raw strictly, fills defaults and validates the result.
func Parse(raw []byte) (*File, error) {
	f := &File{Raw: raw}
	dec := yaml.NewDecoder(bytes.NewReader(raw))
	dec.KnownFields(true)
	if err := dec.Decode(f); err != nil && !errors.Is(err, io.EOF) {
		return nil, err
	}
	var extra any
	if err := dec.Decode(&extra); !errors.Is(err, io.EOF) {
		return nil, errors.New("holds more than one YAML document")
	}
	f.applyDefaults()
	if errs := f.validate(); len(errs) > 0 {
		return nil, fmt.Errorf("invalid access file:\n  - %s", strings.Join(errs, "\n  - "))
	}
	return f, nil
}

func (f *File) applyDefaults() {
	for i := range f.Issuers {
		is := &f.Issuers[i]
		if is.Audience == "" {
			is.Audience = DefaultAudience
		}
		if is.UsernameClaim == "" {
			is.UsernameClaim = DefaultUsernameClaim
		}
	}
	for i := range f.Users {
		u := &f.Users[i]
		if len(u.Networks) == 0 {
			u.Networks = []string{anyNetwork}
		}
		if u.Login.Token != nil && u.Login.Token.Subject == "" {
			u.Login.Token.Subject = u.Name
		}
	}
}

// Issuer returns the issuer called name.
func (f *File) Issuer(name string) (*Issuer, bool) {
	for i := range f.Issuers {
		if f.Issuers[i].Name == name {
			return &f.Issuers[i], true
		}
	}
	return nil, false
}

// User returns the user called name.
func (f *File) User(name string) (*User, bool) {
	for i := range f.Users {
		if f.Users[i].Name == name {
			return &f.Users[i], true
		}
	}
	return nil, false
}

func (f *File) validate() []string {
	var errs []string
	add := func(where, format string, args ...any) {
		errs = append(errs, where+": "+fmt.Sprintf(format, args...))
	}

	seenIssuers := map[string]bool{}
	for i, is := range f.Issuers {
		where := fmt.Sprintf("issuers[%d] %q", i, is.Name)
		if !issuerNameRE.MatchString(is.Name) {
			add(where, "name must match %s", issuerNameRE)
		}
		if seenIssuers[is.Name] {
			add(where, "duplicate issuer name")
		}
		seenIssuers[is.Name] = true
		if err := checkEndpoint(is.URL); err != nil {
			add(where, "url: %v", err)
		}
		if is.JWKSURL != "" {
			if err := checkEndpoint(is.JWKSURL); err != nil {
				add(where, "jwks_url: %v", err)
			}
		}
		for claim, value := range is.RequiredClaims {
			switch value.(type) {
			case string, bool, int, float64:
			default:
				add(where, "required_claims.%s must be a string, number or boolean", claim)
			}
		}
	}

	seenUsers := map[string]bool{}
	for i, u := range f.Users {
		where := fmt.Sprintf("users[%d] %q", i, u.Name)
		switch {
		case !userNameRE.MatchString(u.Name):
			add(where, "name must match %s", userNameRE)
		case u.Name == "default" || strings.HasPrefix(u.Name, "tier_"):
			add(where, "name is reserved")
		}
		if seenUsers[u.Name] {
			add(where, "duplicate user name")
		}
		seenUsers[u.Name] = true

		if _, err := ParseTier(string(u.Tier)); err != nil {
			add(where, "%v", err)
		} else if u.Tier.TakesDatabases() && len(u.Databases) == 0 {
			add(where, "tier %s needs a databases list", u.Tier)
		} else if !u.Tier.TakesDatabases() && len(u.Databases) > 0 {
			add(where, "tier %s takes no databases list", u.Tier)
		}
		seenDBs := map[string]bool{}
		for _, db := range u.Databases {
			switch {
			case !databaseNameRE.MatchString(db):
				add(where, "database %q must match %s", db, databaseNameRE)
			case forbiddenDatabases[db]:
				add(where, "database %q cannot be granted", db)
			case seenDBs[db]:
				add(where, "database %q listed twice", db)
			}
			seenDBs[db] = true
		}
		for _, n := range u.Networks {
			if _, err := netip.ParsePrefix(n); err != nil {
				if _, err := netip.ParseAddr(n); err != nil {
					add(where, "network %q is neither an IP address nor a CIDR", n)
				}
			}
		}

		switch l := u.Login; {
		case (l.Rolling == nil) == (l.Token == nil):
			add(where, "login needs exactly one of rolling or token")
		case l.Rolling != nil:
			if !filepath.IsAbs(l.Rolling.Dir) {
				add(where, "login.rolling.dir must be an absolute path")
			}
		case l.Token != nil:
			is, ok := f.Issuer(l.Token.Issuer)
			if !ok {
				add(where, "login.token.issuer %q is not declared", l.Token.Issuer)
			} else if u.Tier == TierAdmin && !is.AllowAdmin {
				add(where, "an admin token user needs allow_admin on issuer %q", is.Name)
			}
		}
	}
	return errs
}

// checkEndpoint accepts an https URL, or http on a loopback host (tests).
func checkEndpoint(raw string) error {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return fmt.Errorf("%q is not an absolute URL", raw)
	}
	if u.RawQuery != "" || u.Fragment != "" || u.User != nil {
		return fmt.Errorf("%q must carry no query, fragment or credentials", raw)
	}
	switch u.Scheme {
	case "https":
		return nil
	case "http":
		if isLoopbackHost(u.Hostname()) {
			return nil
		}
	}
	return fmt.Errorf("%q must use https", raw)
}

func isLoopbackHost(host string) bool {
	if host == "localhost" {
		return true
	}
	addr, err := netip.ParseAddr(host)
	return err == nil && addr.IsLoopback()
}

// ValidateListen accepts only a loopback host:port: the sidecar answers for
// every token user, so nothing outside the pod may reach it.
func ValidateListen(addr string) error {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return fmt.Errorf("CLICKHOUSE_ACCESS_LISTEN %q: %w", addr, err)
	}
	if ip, err := netip.ParseAddr(host); err != nil || !ip.IsLoopback() {
		return fmt.Errorf("CLICKHOUSE_ACCESS_LISTEN %q must be a loopback IP address, such as 127.0.0.1", addr)
	}
	if port == "" || port == "0" {
		return fmt.Errorf("CLICKHOUSE_ACCESS_LISTEN %q needs a fixed port", addr)
	}
	return nil
}

func (is *Issuer) loadCA() error {
	if is.CAFile == "" {
		return nil
	}
	pem, err := os.ReadFile(is.CAFile)
	if err != nil {
		return fmt.Errorf("ca_file: %w", err)
	}
	pool, err := x509.SystemCertPool()
	if err != nil {
		pool = x509.NewCertPool()
	}
	if !pool.AppendCertsFromPEM(pem) {
		return fmt.Errorf("ca_file %s holds no PEM certificate", is.CAFile)
	}
	is.CAPool = pool
	return nil
}
