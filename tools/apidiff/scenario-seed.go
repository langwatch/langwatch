package apidiff

import (
	"fmt"
	"net/http"
	"sync"
)

// shardContext is the credentials and ids one slice of the pool runs with:
// the seeded fixtures for shared, or an isolated project or organization the
// engine seeded for this stack. err names why seeding it failed, so every
// scenario that lands on it ends as ERROR with the reason.
type shardContext struct {
	keys          Keys
	restricted    string
	restrictedErr string
	vars          map[string]string
	err           string
}

func sharedShard(keys Keys) *shardContext {
	return &shardContext{keys: keys, vars: map[string]string{
		"projectId": seededProjectID, "orgId": seededOrganizationID,
		"projectKey": keys.ProjectKey, "orgKey": keys.OrgKey, "teamId": seededTeamID,
	}}
}

func bearerHeader(token string) map[string]string {
	return map[string]string{"Authorization": "Bearer " + token}
}

// authHeaders is the credential a scenario's auth kind sends on this side.
func (side *scenarioSide) authHeaders(shard *shardContext, kind string) (map[string]string, error) {
	switch kind {
	case authNone:
		return map[string]string{}, nil
	case authProject:
		return tokenHeaders(kind, shard.keys.ProjectKey, func(token string) map[string]string { return map[string]string{"X-Auth-Token": token} })
	case authProjectB:
		return projectBHeaders(side, shard)
	case authProjectC:
		return projectCHeaders(shard)
	case authOrg:
		return tokenHeaders(kind, shard.keys.OrgKey, bearerHeader)
	case authAdmin:
		return tokenHeaders(kind, shard.keys.AdminKey, bearerHeader)
	case authSCIM:
		return tokenHeaders(kind, shard.keys.ScimKey, bearerHeader)
	case authRestricted:
		return restrictedHeaders(shard)
	case authSession:
		return sessionCredentialHeaders(side)
	case authCLI:
		return tokenHeaders(kind, side.creds[credCLIToken], bearerHeader)
	}
	return nil, fmt.Errorf("auth %q is not a known kind", kind)
}

func projectKeyHeader(token string) map[string]string {
	return map[string]string{"X-Auth-Token": token}
}

// projectBHeaders is a same-organization sibling of the shard's project: the
// -project-key-b key when given, else another seeded project of the stack.
func projectBHeaders(side *scenarioSide, shard *shardContext) (map[string]string, error) {
	if shard.keys.ProjectKeyB != "" {
		return projectKeyHeader(shard.keys.ProjectKeyB), nil
	}
	if sibling := side.sibling(shard); sibling != nil {
		return projectKeyHeader(sibling.keys.ProjectKey), nil
	}
	return nil, fmt.Errorf("auth \"project-b\" needs a second project in the same organization: pass -project-key-b, or run with -scenario-shards 2 or more")
}

// projectCHeaders is a project of another organization, which only a key
// flag or an organization the admin key can provision supplies.
func projectCHeaders(shard *shardContext) (map[string]string, error) {
	if shard.keys.ProjectKeyC == "" {
		return nil, fmt.Errorf("auth \"project-c\" needs a project in another organization: pass -project-key-c, or -admin-key (LANGWATCH_INSTANCE_ADMIN_API_KEY on the stack) so one can be provisioned")
	}
	return projectKeyHeader(shard.keys.ProjectKeyC), nil
}

// sibling is a seeded project of the side other than the shard's own.
func (side *scenarioSide) sibling(shard *shardContext) *shardContext {
	for _, candidate := range side.projects {
		if candidate.err == "" && candidate.keys.ProjectKey != "" && candidate.keys.ProjectKey != shard.keys.ProjectKey {
			return candidate
		}
	}
	return nil
}

func tokenHeaders(kind, token string, build func(string) map[string]string) (map[string]string, error) {
	if token == "" {
		return nil, fmt.Errorf("auth %q has no credential on this stack (see the key flags)", kind)
	}
	return build(token), nil
}

func restrictedHeaders(shard *shardContext) (map[string]string, error) {
	if shard.restricted == "" {
		return nil, fmt.Errorf("auth \"restricted\" has no key on this stack: %s", shard.restrictedErr)
	}
	return map[string]string{"Authorization": "Bearer " + shard.restricted, "X-Auth-Token": shard.restricted}, nil
}

func sessionCredentialHeaders(side *scenarioSide) (map[string]string, error) {
	cookie := side.creds[credSessionCookie]
	if cookie == "" {
		return nil, fmt.Errorf("auth \"session\" could not sign the seeded admin in on this stack")
	}
	return map[string]string{"Cookie": cookie, "Origin": browserOrigin(side.baseURL)}, nil
}

// scenarioNeeds is what a set of scenarios asks the engine to seed.
type scenarioNeeds struct {
	projects, orgs           int
	restricted, sessionLogin bool
	siblings                 bool
}

func needsOf(items []scenario, shards int) scenarioNeeds {
	var needs scenarioNeeds
	for index := range items {
		item := &items[index]
		switch item.Shard {
		case shardProject:
			needs.projects++
		case shardOrg:
			needs.orgs++
		}
		needs.siblings = needs.siblings || usesAuth(item, authProjectB)
		needs.restricted = needs.restricted || usesAuth(item, authRestricted)
		needs.sessionLogin = needs.sessionLogin || usesAuth(item, authSession) || usesAuth(item, authCLI)
	}
	if needs.siblings {
		needs.projects = max(needs.projects, 2)
	}
	needs.projects = min(needs.projects, shards)
	needs.orgs = min(needs.orgs, shards)
	return needs
}

func usesAuth(item *scenario, kind string) bool {
	if item.Auth == kind {
		return true
	}
	for _, list := range [][]scenarioStep{item.Setup, item.Verify} {
		for index := range list {
			if list[index].Request != nil && list[index].Request.Auth == kind {
				return true
			}
		}
	}
	return false
}

// seed mints the isolated projects and organizations on both stacks, and the
// restricted keys and sessions the scenarios ask for, all in parallel.
func (runner *scenarioRunner) seed(needs scenarioNeeds) {
	var session sync.WaitGroup
	defer session.Wait()
	for _, side := range runner.sides {
		if needs.sessionLogin {
			session.Add(1)
			go func() { defer session.Done(); runner.engine.mintCLISession(side.baseURL, side.creds) }()
		}
	}
	if runner.options.SeedDir != "" && len(runner.sides) == 1 {
		runner.seedShared(needs)
		return
	}
	var group sync.WaitGroup
	for _, side := range runner.sides {
		side.projects = make([]*shardContext, needs.projects)
		side.orgs = make([]*shardContext, needs.orgs)
		for index := range side.projects {
			group.Add(1)
			go func() { defer group.Done(); side.projects[index] = runner.seedProject(side, index) }()
		}
		for index := range side.orgs {
			group.Add(1)
			go func() { defer group.Done(); side.orgs[index] = runner.seedOrg(side, runner.orgName(index)) }()
		}
	}
	group.Wait()
	if needs.restricted {
		runner.seedRestricted()
	}
}

func (runner *scenarioRunner) seedRestricted() {
	var group sync.WaitGroup
	for _, side := range runner.sides {
		for _, shard := range side.allShards() {
			group.Add(1)
			go func() { defer group.Done(); runner.mintRestricted(side, shard) }()
		}
	}
	group.Wait()
}

func (side *scenarioSide) allShards() []*shardContext {
	all := append([]*shardContext{side.shared}, side.projects...)
	return append(all, side.orgs...)
}

func (runner *scenarioRunner) call(side *scenarioSide, method, path, bearer string, body any) rawResult {
	return runner.engine.fixtureRequest(fixtureCall{method: method, url: side.baseURL + path, headers: bearerHeader(bearer), body: body})
}

func seedFailure(what string, result rawResult) string {
	if result.status == 0 {
		return what + ": no answer"
	}
	return fmt.Sprintf("%s: status %d %v", what, result.status, excerptValue(result.body))
}

func succeeded(result rawResult) bool {
	return result.status == http.StatusOK || result.status == http.StatusCreated
}

// seedProject makes one isolated project in the seeded organization.
func (runner *scenarioRunner) seedProject(side *scenarioSide, index int) *shardContext {
	orgKey := side.shared.keys.OrgKey
	shard := &shardContext{keys: side.shared.keys, vars: map[string]string{"orgId": side.shared.vars["orgId"], "orgKey": orgKey}}
	name := fmt.Sprintf("apidiff-shard-%s-p%d", runner.tag, index)
	created := runner.call(side, http.MethodPost, "/api/projects", orgKey, projectBody(name, ""))
	runner.fileProject(shard, created)
	return shard
}

func projectBody(name, teamID string) map[string]any {
	body := map[string]any{"name": name, "language": "python", "framework": "openai"}
	if teamID == "" {
		body["newTeamName"] = name
	} else {
		body["teamId"] = teamID
	}
	return body
}

// fileProject reads a created project's id and service key into a shard.
func (runner *scenarioRunner) fileProject(shard *shardContext, created rawResult) {
	id, _ := created.body["id"].(string)
	key, _ := created.body["serviceApiKey"].(string)
	if !succeeded(created) || id == "" || key == "" {
		shard.err = seedFailure("seed project", created)
		return
	}
	shard.keys.ProjectKey = key
	shard.vars["projectId"], shard.vars["projectKey"] = id, key
	if teamID, _ := created.body["teamId"].(string); teamID != "" {
		shard.vars["teamId"] = teamID
	}
}

// seedOrg makes one isolated organization with a project of its own.
func (runner *scenarioRunner) orgName(index int) string {
	return fmt.Sprintf("apidiff-shard-%s-o%d", runner.tag, index)
}

func (runner *scenarioRunner) seedOrg(side *scenarioSide, name string) *shardContext {
	shard := &shardContext{keys: runner.options.Keys, vars: map[string]string{}}
	if runner.options.Keys.AdminKey == "" {
		shard.err = "org-sharded scenarios need the instance admin key: pass -admin-key"
		return shard
	}
	created := runner.call(side, http.MethodPost, "/api/organizations", runner.options.Keys.AdminKey, map[string]any{"name": name, "slug": name})
	organization, _ := created.body["organization"].(map[string]any)
	team, _ := created.body["team"].(map[string]any)
	adminKey, _ := created.body["adminApiKey"].(map[string]any)
	orgID, _ := organization["id"].(string)
	teamID, _ := team["id"].(string)
	token, _ := adminKey["token"].(string)
	if !succeeded(created) || orgID == "" || token == "" {
		shard.err = seedFailure("seed organization", created)
		return shard
	}
	shard.keys.OrgKey = token
	shard.vars["orgId"], shard.vars["orgKey"], shard.vars["teamId"] = orgID, token, teamID
	runner.fileProject(shard, runner.call(side, http.MethodPost, "/api/projects", token, projectBody(name, teamID)))
	return shard
}

// mintRestricted makes a read-only key bound to the shard's project, the
// credential a "restricted" scenario is refused with.
func (runner *scenarioRunner) mintRestricted(side *scenarioSide, shard *shardContext) {
	if shard.restricted != "" {
		return
	}
	if shard.err != "" {
		shard.restrictedErr = shard.err
		return
	}
	body := map[string]any{
		"keyType": "service", "name": "apidiff-restricted-" + runner.tag, "permissionMode": "readonly",
		"bindings": []map[string]any{{"role": "VIEWER", "scopeType": "PROJECT", "scopeId": shard.vars["projectId"]}},
	}
	minted := runner.call(side, http.MethodPost, "/api/api-keys", shard.keys.OrgKey, body)
	token, _ := minted.body["token"].(string)
	if !succeeded(minted) || token == "" {
		shard.restrictedErr = seedFailure("mint restricted key", minted)
		return
	}
	shard.restricted = token
}
