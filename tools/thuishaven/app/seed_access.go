package app

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/langwatch/langwatch/tools/seedgen"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// SeedLogin is one account a tester can sign in with.
type SeedLogin struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// SeedAccess is what `haven seed` hands a tester: where the stack is, who to
// sign in as, and the credentials haven made up for it. Secret values are
// masked unless the caller asked for them, as `haven env` masks them.
type SeedAccess struct {
	App                 string      `json:"app"`
	Logins              []SeedLogin `json:"logins"`
	Organization        string      `json:"organization"`
	Team                string      `json:"team"`
	Project             string      `json:"project"`
	ProjectAPIKey       string      `json:"projectApiKey"`
	PersonalAccessToken string      `json:"personalAccessToken"`
	SCIMToken           string      `json:"scimToken"`
	InstanceAdminKey    string      `json:"instanceAdminKey"`
	// Orgs are the orgs the seed created on this stack, from its run records; the admin above
	// is an admin member of every one.
	Orgs []SeedOrg `json:"orgs"`
}

// SeedOrg is one seeded org and the logins of its members, all on the one dev password.
type SeedOrg struct {
	Name    string      `json:"name"`
	ID      string      `json:"id"`
	Persona string      `json:"persona"`
	Logins  []SeedLogin `json:"logins"`
}

// shownLogins is how many of an org's logins the text block prints; --json lists them all.
const shownLogins = 5

// seededOrgs reads every run record of the stack and keeps what its acks minted, never the plan's
// wish: an org or user is listed only once the product returned its id.
func (o *Orchestrator) seededOrgs(slug, password string) []SeedOrg {
	dirs, _ := os.ReadDir(o.seedRunsDir(slug))
	seen := map[string]bool{}
	var orgs []SeedOrg
	for _, dir := range dirs {
		plan, refs, ok := readSeedRun(filepath.Join(o.seedRunsDir(slug), dir.Name()))
		if !ok {
			continue
		}
		for _, org := range plan.Orgs {
			id, minted := refs[org.Ref]
			if !minted || seen[id] || plan.Flags.Into != "" {
				continue
			}
			seen[id] = true
			seeded := SeedOrg{Name: org.Key, ID: id, Persona: org.Persona, Logins: []SeedLogin{}}
			for _, user := range org.Users {
				if _, ok := refs[user.Ref]; ok && user.State == "accepted" {
					seeded.Logins = append(seeded.Logins, SeedLogin{Email: user.Email, Password: password})
				}
			}
			orgs = append(orgs, seeded)
		}
	}
	slices.SortFunc(orgs, func(a, b SeedOrg) int { return strings.Compare(a.Name, b.Name) })
	return orgs
}

func readSeedRun(dir string) (*seedgen.Plan, seedgen.Refs, bool) {
	data, err := os.ReadFile(filepath.Join(dir, "manifest.json"))
	var manifest seedgen.Manifest
	if err != nil || json.Unmarshal(data, &manifest) != nil {
		return nil, nil, false
	}
	checkpoint, err := seedgen.LoadCheckpoint(filepath.Join(dir, "run.json"), manifest.Run)
	if err != nil {
		return nil, nil, false
	}
	plan, err := seedgen.NewPlan(manifest.Flags)
	if err != nil {
		return nil, nil, false
	}
	return plan, checkpoint.Refs, true
}

// seedAccess reads the access from this stack's `haven env` set; a key that
// set lacks yielded to the developer's .env, so it is read from there.
func (o *Orchestrator) seedAccess(p UpParams, reveal bool) (SeedAccess, error) {
	env, err := o.StackEnv(p)
	if err != nil {
		return SeedAccess{}, err
	}
	stack, resolved := domain.EnvMap(env), resolvedDevEnv(p.WorktreeDir)
	shown := envShower(p.WorktreeDir, reveal)
	value := func(key string) string {
		v, ok := stack[key]
		if !ok {
			v = resolved[key]
		}
		return shown(key, v)
	}
	slug, err := o.resolveSlug(p)
	if err != nil {
		return SeedAccess{}, err
	}
	return SeedAccess{
		Orgs:                o.seededOrgs(slug, value("LANGWATCH_ADMIN_PASSWORD")),
		App:                 stack["LANGWATCH_ENDPOINT"],
		Logins:              []SeedLogin{{Email: value("LANGWATCH_ADMIN_EMAIL"), Password: value("LANGWATCH_ADMIN_PASSWORD")}},
		Organization:        domain.DefaultOrganizationSlug,
		Team:                domain.DefaultTeamSlug,
		Project:             domain.DefaultProjectSlug,
		ProjectAPIKey:       value("HAVEN_SEED_LANGWATCH_API_KEY"),
		PersonalAccessToken: value("LANGWATCH_PRIVATE_ACCESS_TOKEN"),
		SCIMToken:           value("HAVEN_SEED_SCIM_TOKEN"),
		InstanceAdminKey:    value("LANGWATCH_INSTANCE_ADMIN_API_KEY"),
	}, nil
}

// printSeedAccess is the block `haven seed` ends with, or its --json object.
func (o *Orchestrator) printSeedAccess(p UpParams, asJSON, reveal bool) error {
	access, err := o.seedAccess(p, reveal)
	if err != nil {
		return err
	}
	if asJSON {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(access)
	}
	fmt.Printf("\napp                    %s\n", access.App)
	for _, login := range access.Logins {
		fmt.Printf("login                  %s / %s\n", login.Email, login.Password)
	}
	fmt.Printf("organization           %s (team %s, project %s)\n", access.Organization, access.Team, access.Project)
	fmt.Printf("project API key        %s\n", access.ProjectAPIKey)
	fmt.Printf("personal access token  %s\n", access.PersonalAccessToken)
	fmt.Printf("SCIM token             %s\n", access.SCIMToken)
	fmt.Printf("instance admin key     %s\n", access.InstanceAdminKey)
	for _, org := range access.Orgs {
		fmt.Printf("seeded org             %s (%s, %s), the admin is an admin here\n", org.Name, org.ID, org.Persona)
		for i, login := range org.Logins {
			if i == shownLogins {
				fmt.Printf("                         and %d more logins (--json lists them)\n", len(org.Logins)-shownLogins)
				break
			}
			fmt.Printf("  login                %s / %s\n", login.Email, login.Password)
		}
	}
	if !reveal {
		fmt.Println("haven made these up for this stack; `haven seed --reveal` or `haven env --reveal` shows them")
	}
	return nil
}
