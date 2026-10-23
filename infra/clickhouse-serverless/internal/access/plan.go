package access

import (
	"fmt"
	"sort"
	"time"

	"gopkg.in/yaml.v3"
)

// AuthServerName is the http_authentication_servers entry token users name.
const AuthServerName = "access"

// Inputs are what Plan reads besides the file: each rolling user's passwords.
type Inputs struct {
	Passwords map[string][]Password // by user name
}

// Gather reads every rolling user's password directory.
func Gather(f *File) (Inputs, error) {
	in := Inputs{Passwords: map[string][]Password{}}
	for _, u := range f.Users {
		if u.Login.Rolling == nil {
			continue
		}
		passwords, err := ReadPasswordDir(u.Login.Rolling.Dir)
		if err != nil {
			return Inputs{}, fmt.Errorf("user %q: %w", u.Name, err)
		}
		in.Passwords[u.Name] = passwords
	}
	return in, nil
}

// Planned is the users.d document for the access users, and when it changes
// next without any input changing (the earliest future valid_until).
type Planned struct {
	Users      map[string]any
	Warnings   []string
	NextChange *time.Time
}

// Plan computes the access users as ClickHouse config at instant now. Pure:
// the same file, inputs and instant always give the same document.
func Plan(f *File, in Inputs, now time.Time) Planned {
	p := Planned{Users: map[string]any{}}
	for _, u := range f.Users {
		user := map[string]any{
			"networks": map[string]any{"ip": u.Networks},
			"profile":  u.Tier.Name(),
			"grants":   map[string]any{"query": u.Tier.UserGrants(u.Databases)},
		}
		switch {
		case u.Login.Token != nil:
			user["http_authentication"] = map[string]any{"server": AuthServerName, "scheme": "basic"}
		case u.Login.Rolling != nil:
			methods := map[string]any{}
			seen := map[string]bool{}
			for _, pw := range in.Passwords[u.Name] {
				if pw.ValidUntil != nil && !now.Before(*pw.ValidUntil) {
					continue
				}
				if pw.ValidUntil != nil && (p.NextChange == nil || pw.ValidUntil.Before(*p.NextChange)) {
					until := *pw.ValidUntil
					p.NextChange = &until
				}
				if seen[pw.SHA256Hex] {
					continue
				}
				seen[pw.SHA256Hex] = true
				methods[fmt.Sprintf("password_%d", len(methods)+1)] = map[string]any{"password_sha256_hex": pw.SHA256Hex}
			}
			if len(methods) == 0 {
				p.Warnings = append(p.Warnings, fmt.Sprintf("user %q has no valid password in %s; it cannot log in until one is added", u.Name, u.Login.Rolling.Dir))
				continue
			}
			user["auth_methods"] = methods
		}
		p.Users[u.Name] = user
	}
	return p
}

// UsersYAML is the users.d file for the planned users.
func (p Planned) UsersYAML() ([]byte, error) {
	return yaml.Marshal(map[string]any{"users": p.Users})
}

// UserNames lists the planned users, sorted.
func (p Planned) UserNames() []string {
	names := make([]string, 0, len(p.Users))
	for name := range p.Users {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

// AuthServerYAML is the config.d file pointing ClickHouse's token users at the
// sidecar. ClickHouse waits up to receive_timeout_ms, enough for a cold JWKS fetch.
func AuthServerYAML(listen string) ([]byte, error) {
	return yaml.Marshal(map[string]any{
		"http_authentication_servers": map[string]any{
			AuthServerName: map[string]any{
				"uri":                   "http://" + listen + "/verify",
				"connection_timeout_ms": 1000,
				"receive_timeout_ms":    5000,
				"send_timeout_ms":       1000,
				"max_tries":             2,
			},
		},
	})
}
