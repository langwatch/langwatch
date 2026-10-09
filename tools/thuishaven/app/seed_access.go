package app

import (
	"encoding/json"
	"fmt"
	"os"

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
	return SeedAccess{
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
	fmt.Println("persona users (@seed.test) have no password: sign in as the admin")
	if !reveal {
		fmt.Println("haven made these up for this stack; `haven seed --reveal` or `haven env --reveal` shows them")
	}
	return nil
}
