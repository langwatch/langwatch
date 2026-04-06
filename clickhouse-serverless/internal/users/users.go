package users

import (
	"crypto/sha256"
	"fmt"
	"regexp"
	"strings"

	"gopkg.in/yaml.v3"
)

// User represents a parsed ClickHouse user.
type User struct {
	Name      string
	Role      string   // readonly, readwrite, admin
	Databases []string
	Password  string
	Hash      string // SHA256 hex
}

var validUsername = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*$`)
var validDBName = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

var validRoles = map[string]bool{
	"readonly":  true,
	"readwrite": true,
	"admin":     true,
}

// ParseUsers parses a CH_USERS spec string into User entries.
// Format: "username:password:role:databases;username2:password2:role2:databases2"
// Databases are comma-separated, or "*" for all.
func ParseUsers(spec string) ([]User, error) {
	spec = strings.TrimSpace(spec)
	if spec == "" {
		return nil, nil
	}

	entries := strings.Split(spec, ";")
	users := make([]User, 0, len(entries))
	seen := make(map[string]struct{}, len(entries))

	for _, entry := range entries {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}

		// Parse from the ends to allow colons in passwords.
		// Format: username:password:role:databases
		// Last ":" separates role from databases, second-to-last separates password from role,
		// first ":" separates username from the rest.
		lastColon := strings.LastIndex(entry, ":")
		if lastColon < 0 {
			return nil, fmt.Errorf("invalid user spec %q: expected username:password:role:databases", entry)
		}
		dbSpec := strings.TrimSpace(entry[lastColon+1:])
		rest := entry[:lastColon]

		prevColon := strings.LastIndex(rest, ":")
		if prevColon < 0 {
			return nil, fmt.Errorf("invalid user spec %q: expected username:password:role:databases", entry)
		}
		role := strings.TrimSpace(rest[prevColon+1:])
		rest = rest[:prevColon]

		firstColon := strings.Index(rest, ":")
		if firstColon < 0 {
			return nil, fmt.Errorf("invalid user spec %q: expected username:password:role:databases", entry)
		}
		name := strings.TrimSpace(rest[:firstColon])
		password := rest[firstColon+1:] // don't trim — password may have spaces

		if !validUsername.MatchString(name) {
			return nil, fmt.Errorf("invalid username %q: must match ^[a-zA-Z_][a-zA-Z0-9_]*$", name)
		}
		if _, dup := seen[name]; dup {
			return nil, fmt.Errorf("duplicate username %q", name)
		}
		seen[name] = struct{}{}
		if password == "" {
			return nil, fmt.Errorf("password is required for user %q", name)
		}
		if !validRoles[role] {
			return nil, fmt.Errorf("invalid role %q for user %q: must be readonly, readwrite, or admin", role, name)
		}

		var databases []string
		if dbSpec == "*" {
			databases = []string{"*"}
		} else {
			for _, db := range strings.Split(dbSpec, ",") {
				db = strings.TrimSpace(db)
				if db != "" {
					if !validDBName.MatchString(db) {
						return nil, fmt.Errorf("invalid database name %q for user %q: must match ^[a-zA-Z0-9_-]+$", db, name)
					}
					databases = append(databases, db)
				}
			}
		}
		if len(databases) == 0 {
			return nil, fmt.Errorf("no databases specified for user %q", name)
		}

		users = append(users, User{
			Name:      name,
			Role:      role,
			Databases: databases,
			Password:  password,
			Hash:      sha256Hex(password),
		})
	}

	return users, nil
}

// userYAML is the top-level YAML structure for a user config file.
type userYAML struct {
	Users map[string]userEntry `yaml:"users"`
}

type userEntry struct {
	PasswordSHA256Hex string       `yaml:"password_sha256_hex"`
	Profile           string       `yaml:"profile"`
	Quota             string       `yaml:"quota"`
	Networks          networkEntry `yaml:"networks"`
	Grants            grantsEntry  `yaml:"grants"`
}

type networkEntry struct {
	IP string `yaml:"ip"`
}

type grantsEntry struct {
	Query []string `yaml:"query"`
}

// RenderUser generates the users.d YAML configuration for a single user.
func RenderUser(user User) ([]byte, error) {
	cfg := userYAML{
		Users: map[string]userEntry{
			user.Name: {
				PasswordSHA256Hex: user.Hash,
				Profile:           "default",
				Quota:             "default",
				Networks:          networkEntry{IP: "::/0"},
				Grants:            grantsEntry{Query: buildGrants(user)},
			},
		},
	}
	return yaml.Marshal(&cfg)
}

func buildGrants(user User) []string {
	var privileges []string
	switch user.Role {
	case "readonly":
		privileges = []string{"SELECT"}
	case "readwrite":
		privileges = []string{"SELECT", "INSERT", "ALTER TABLE", "CREATE TABLE", "DROP TABLE"}
	case "admin":
		privileges = []string{"ALL"}
	default:
		return nil
	}

	var grants []string
	for _, priv := range privileges {
		for _, db := range user.Databases {
			var target string
			if db == "*" {
				target = "*.*"
			} else {
				target = fmt.Sprintf("`%s`.*", strings.ReplaceAll(db, "`", "``"))
			}
			grants = append(grants, fmt.Sprintf("GRANT %s ON %s TO %s", priv, target, user.Name))
		}
	}
	return grants
}

func sha256Hex(s string) string {
	h := sha256.Sum256([]byte(s))
	return fmt.Sprintf("%x", h)
}
