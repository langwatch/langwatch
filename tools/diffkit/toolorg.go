package diffkit

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"path/filepath"
	"time"
)

// Seeded fixtures the repository's storage-seed writes (apps/tasks). Every
// haven stack shares one database, so these read on the shared stack.
const (
	SeededProjectKey     = "sk-lw-local-development-key"
	SeededProjectID      = "local-dev-project"
	SeededOrganizationID = "local-dev-organization"
	// SeededOrgKey is the fixed local-dev private access token (org key).
	SeededOrgKey = "sk-lw-LocalDevPrivate1_LocalDevPrivateAccessTokenSecretFixedValue000000" // #nosec G101 -- the public local-dev token every haven stack seeds.
)

// ToolOrg is one tool's own organisation on the shared stack: its org key, a
// project (key and id), and a read-only key, so every tool seeds the same way.
// Separate reports whether it is a genuinely separate tenant (admin-key mode)
// or the shared seeded org (fallback), which the cross-tenant oracle needs.
type ToolOrg struct {
	Name       string        `json:"name"`
	OrgKey     string        `json:"orgKey"`
	OrgID      string        `json:"orgId"`
	TeamID     string        `json:"teamId,omitempty"`
	Projects   []ToolProject `json:"projects"`
	Restricted string        `json:"restricted,omitempty"`
	Separate   bool          `json:"separate"`
}

// ToolProject is one seeded project's key and id.
type ToolProject struct {
	Key string `json:"key"`
	ID  string `json:"id"`
}

// SeedOptions configures SeedToolOrg. BaseURL is the app origin (no /api).
type SeedOptions struct {
	BaseURL  string
	Tool     string
	Projects int
	Dir      string // where the record and lock live
	Progress func(string)
	Client   *http.Client
}

// The ceremony signs in as the seeded local-dev admin (the account behind the
// stack's ADMIN_EMAILS) over /api/auth/sign-in/email, then creates the tool's
// own organisation with organization.createAndAssign. HTTP sign-up is not
// mounted here (404) and POST /api/organizations needs an instance admin key
// the stack has not configured, so this is the path that works.
const (
	SeededAdminEmail    = "admin@mail.langwatch.localhost"
	SeededAdminPassword = "LocalHavenAdmin!2026" // #nosec G101 -- the public local-dev admin password every haven stack seeds.
	// CeremonyPassword is exported for the UI runner's plan.json; it signs in
	// as the same seeded admin.
	CeremonyPassword = SeededAdminPassword
)

// CeremonyEmail is the sign-in identity the UI runner uses: the seeded admin.
func CeremonyEmail(string) string { return SeededAdminEmail }

// SeedToolOrg provisions (or reuses) the tool's organisation through the public
// API, idempotent and recorded, under a flock. With an admin key it makes a
// separate organisation; without one it uses the seeded org and dedicated
// projects. It never seeds twice at once and never restarts the stack.
func SeedToolOrg(ctx context.Context, options SeedOptions) (ToolOrg, error) {
	if options.Projects < 1 {
		options.Projects = 1
	}
	say := options.Progress
	if say == nil {
		say = func(string) {}
	}
	unlock, err := Lock(options.Dir, options.Tool+"-seed.lock", "seed: another lane is seeding "+options.Tool+"; waiting", say)
	if err != nil {
		return ToolOrg{}, err
	}
	defer unlock()
	path := filepath.Join(options.Dir, options.Tool+"-seed.json")
	seeder := &orgSeeder{options: options, client: clientOr(options.Client)}
	seeder.origin = options.BaseURL
	if org, ok := seeder.reuse(ctx, path); ok {
		say(fmt.Sprintf("seed: %s reuses its recorded organisation", options.Tool))
		return org, nil
	}
	org, err := seeder.provision(ctx)
	if err != nil {
		return ToolOrg{}, err
	}
	if err := writeRecord(path, org); err != nil {
		say("seed: the record was not saved: " + err.Error())
	}
	return org, nil
}

type orgSeeder struct {
	options SeedOptions
	client  *http.Client
	origin  string
}

func clientOr(client *http.Client) *http.Client {
	jar, _ := cookiejar.New(nil)
	if client != nil {
		client.Jar = jar
		return client
	}
	return &http.Client{Timeout: 60 * time.Second, Jar: jar}
}

// reuse rebuilds the recorded org when its key still authenticates and it has
// enough projects.
func (seeder *orgSeeder) reuse(ctx context.Context, path string) (ToolOrg, bool) {
	content, err := os.ReadFile(path) // #nosec G304 -- the tool's own record.
	if err != nil {
		return ToolOrg{}, false
	}
	var org ToolOrg
	if json.Unmarshal(content, &org) != nil || len(org.Projects) < seeder.options.Projects {
		return ToolOrg{}, false
	}
	status, _ := seeder.call(ctx, http.MethodGet, "/api/projects", bearer(org.OrgKey), nil)
	return org, status == http.StatusOK
}

// errGrantUnconfirmed is the ceremony hitting a stack with no worker: the
// authz grant pipeline (a worker projection) never lands, so a runtime-created
// org's founder grant never confirms. The caller falls back to the seeded org.
var errGrantUnconfirmed = errors.New("authz grant not confirmed: the stack runs no worker to project it")

// provision creates the tool's own org, its projects and a read-only key. When
// the stack cannot confirm a runtime grant (no worker), it falls back to the
// pre-seeded local-dev org, whose grants the tasks seed already confirmed, so
// the tool still runs live; the org is then shared, not separate.
func (seeder *orgSeeder) provision(ctx context.Context) (ToolOrg, error) {
	org, err := seeder.baseOrg(ctx)
	if errors.Is(err, errGrantUnconfirmed) {
		if seeder.options.Progress != nil {
			seeder.options.Progress("seed: the stack confirms no runtime grant (no worker); falling back to the seeded local-dev org (shared, not separate)")
		}
		return seededFallbackOrg(seeder.options.Tool), nil
	}
	if err != nil {
		return ToolOrg{}, err
	}
	for index := len(org.Projects); index < seeder.options.Projects; index++ {
		project, err := seeder.seedProject(ctx, org, index)
		if err != nil {
			return ToolOrg{}, err
		}
		org.Projects = append(org.Projects, project)
	}
	org.Restricted = seeder.mintRestricted(ctx, org)
	return org, nil
}

// seededFallbackOrg is the pre-seeded local-dev org's credentials, the only
// ones usable on a worker-less stack. Separate is false, so the cross-tenant
// oracle stands down.
func seededFallbackOrg(tool string) ToolOrg {
	return ToolOrg{
		Name: tool, OrgKey: SeededOrgKey, OrgID: SeededOrganizationID, Separate: false,
		Projects: []ToolProject{{Key: SeededProjectKey, ID: SeededProjectID}},
	}
}

// baseOrg runs the sign-up ceremony: a fresh user, whose onboarding creates
// the tool's own organisation, then an org service key minted through the
// session. This is the path that works on any stack (POST /api/organizations
// needs a configured instance admin key it does not have here).
func (seeder *orgSeeder) baseOrg(ctx context.Context) (ToolOrg, error) {
	if err := seeder.signIn(ctx); err != nil {
		return ToolOrg{}, err
	}
	orgID, teamID, err := seeder.createOrganization(ctx)
	if err != nil {
		return ToolOrg{}, err
	}
	orgKey, err := seeder.mintOrgKey(ctx, orgID)
	if err != nil {
		return ToolOrg{}, err
	}
	return ToolOrg{Name: seeder.options.Tool, OrgKey: orgKey, OrgID: orgID, TeamID: teamID, Separate: true}, nil
}

// signIn signs in as the seeded local-dev admin; the cookie jar carries the
// session onward.
func (seeder *orgSeeder) signIn(ctx context.Context) error {
	status, body := seeder.call(ctx, http.MethodPost, "/api/auth/sign-in/email", nil, map[string]any{"email": SeededAdminEmail, "password": SeededAdminPassword})
	if !created(status) {
		return fmt.Errorf("ceremony sign-in: status %d %v", status, excerpt(body))
	}
	if !seeder.authenticated(ctx) {
		return fmt.Errorf("ceremony sign-in: no session established")
	}
	return nil
}

func (seeder *orgSeeder) authenticated(ctx context.Context) bool {
	status, _ := seeder.call(ctx, http.MethodGet, "/api/auth/session", nil, nil)
	return status == http.StatusOK
}

// grantPending is the code createAndAssign returns while the founder's ADMIN
// grants are still being confirmed. The organisation itself is already
// committed, so the ceremony polls getAll for it rather than retrying (which
// would strand a second, empty organisation).
const grantPending = "authz_grant_not_confirmed"

// createOrganization makes the tool's own organisation, then waits for the
// grant to confirm by polling getAll for it, returning its confirmed ids.
func (seeder *orgSeeder) createOrganization(ctx context.Context) (orgID, teamID string, err error) {
	_, code, postErr := seeder.trpcPost(ctx, "organization.createAndAssign", map[string]any{"orgName": seeder.options.Tool})
	if postErr != nil && code != grantPending {
		return "", "", postErr
	}
	return seeder.awaitOrganization(ctx)
}

// awaitOrganization polls getAll until the tool's organisation is visible (its
// grant confirmed), returning its id and first team id.
func (seeder *orgSeeder) awaitOrganization(ctx context.Context) (string, string, error) {
	deadline := time.Now().Add(15 * time.Second)
	for attempt := 0; ; attempt++ {
		raw, code, err := seeder.trpcGet(ctx, "organization.getAll", map[string]any{})
		if err == nil {
			if orgID, teamID, ok := findOrg(raw, seeder.options.Tool); ok {
				return orgID, teamID, nil
			}
		}
		if attempt == 0 && seeder.options.Progress != nil {
			names := ""
			if list, ok := raw.([]any); ok {
				for _, entry := range list {
					if org, ok := entry.(map[string]any); ok {
						names += fmt.Sprintf("%v ", org["name"])
					}
				}
			}
			seeder.options.Progress(fmt.Sprintf("seed: getAll err=%v code=%q orgs=[%s]", err, code, names))
		}
		if time.Now().After(deadline) {
			return "", "", errGrantUnconfirmed
		}
		select {
		case <-ctx.Done():
			return "", "", ctx.Err()
		case <-time.After(time.Second):
		}
	}
}

// findOrg picks the tool's organisation (the last match, so a re-run's newest
// wins) from getAll's list and returns its id and first team id.
func findOrg(raw any, name string) (orgID, teamID string, ok bool) {
	list, _ := raw.([]any)
	for _, entry := range list {
		org, _ := entry.(map[string]any)
		if org["name"] != name {
			continue
		}
		id, _ := org["id"].(string)
		teams, _ := org["teams"].([]any)
		if id == "" || len(teams) == 0 {
			continue
		}
		team, _ := teams[0].(map[string]any)
		if tid, _ := team["id"].(string); tid != "" {
			orgID, teamID, ok = id, tid, true
		}
	}
	return orgID, teamID, ok
}

// mintOrgKey mints an all-permissions service key for the organisation, the org
// key every later seeding call authenticates with. It retries while the founder
// ADMIN grant is still confirming (api_key_admin_required), the same eventual
// consistency that makes createAndAssign answer grant-pending.
func (seeder *orgSeeder) mintOrgKey(ctx context.Context, orgID string) (string, error) {
	input := map[string]any{"organizationId": orgID, "name": seeder.options.Tool + "-org", "keyType": "service", "permissionMode": "all", "bindings": []any{}}
	deadline := time.Now().Add(15 * time.Second)
	for {
		result, code, err := seeder.trpcPost(ctx, "apiKey.create", input)
		if err == nil {
			object, _ := result.(map[string]any)
			if token, _ := object["token"].(string); token != "" {
				return token, nil
			}
			return "", fmt.Errorf("apiKey.create returned no token")
		}
		if code == "api_key_admin_required" && time.Now().After(deadline) {
			return "", errGrantUnconfirmed
		}
		if code != "api_key_admin_required" {
			return "", fmt.Errorf("apiKey.create: %s: %w", code, err)
		}
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(time.Second):
		}
	}
}

// trpcPost posts one tRPC mutation over the session cookie. The wire is
// {"json": input} in, result.data.json out; a domain error is returned with its
// code so the caller can tell a pending grant from a real failure.
func (seeder *orgSeeder) trpcPost(ctx context.Context, path string, input any) (any, string, error) {
	status, body := seeder.call(ctx, http.MethodPost, "/api/trpc/"+path, nil, input)
	return trpcResult(path, status, body)
}

// trpcGet is the query half: GET ?input=<urlencoded input>. This stack's tRPC
// has no superjson transformer, so input is sent and read unwrapped.
func (seeder *orgSeeder) trpcGet(ctx context.Context, path string, input any) (any, string, error) {
	encoded, _ := json.Marshal(input)
	status, body := seeder.call(ctx, http.MethodGet, "/api/trpc/"+path+"?input="+url.QueryEscape(string(encoded)), nil, nil)
	return trpcResult(path, status, body)
}

func trpcResult(path string, status int, body map[string]any) (any, string, error) {
	if body["error"] != nil {
		code := trpcErrorCode(body["error"])
		return nil, code, fmt.Errorf("trpc %s: status %d code %q", path, status, code)
	}
	if !created(status) {
		return nil, "", fmt.Errorf("trpc %s: status %d %v", path, status, excerpt(body))
	}
	result, _ := body["result"].(map[string]any)
	data, ok := result["data"]
	if !ok {
		return nil, "", fmt.Errorf("trpc %s: no result.data in %v", path, excerpt(body))
	}
	// Mutations answer superjson-wrapped (result.data.json); queries answer the
	// value directly at result.data. Accept both.
	if object, ok := data.(map[string]any); ok {
		if value, present := object["json"]; present {
			return value, "", nil
		}
	}
	return data, "", nil
}

// trpcErrorCode digs the domain code out of a tRPC error envelope, tolerating
// both the plain and the ".json" shapes.
func trpcErrorCode(envelope any) string {
	node, _ := envelope.(map[string]any)
	if inner, ok := node["json"].(map[string]any); ok {
		node = inner
	}
	data, _ := node["data"].(map[string]any)
	inner, _ := data["error"].(map[string]any)
	if kind, _ := inner["kind"].(string); kind != "" {
		return kind
	}
	if code, _ := inner["code"].(string); code != "" {
		return code
	}
	return ""
}

func excerpt(body map[string]any) string {
	encoded, _ := json.Marshal(body)
	if len(encoded) > 300 {
		return string(encoded[:300])
	}
	return string(encoded)
}

func (seeder *orgSeeder) seedProject(ctx context.Context, org ToolOrg, index int) (ToolProject, error) {
	body := map[string]any{"name": fmt.Sprintf("%s-p%d", seeder.options.Tool, index), "language": "python", "framework": "openai"}
	if org.TeamID != "" {
		body["teamId"] = org.TeamID
	} else {
		body["newTeamName"] = fmt.Sprintf("%s-t%d", seeder.options.Tool, index)
	}
	status, created := seeder.call(ctx, http.MethodPost, "/api/projects", bearer(org.OrgKey), body)
	id, _ := created["id"].(string)
	key, _ := created["serviceApiKey"].(string)
	if !succeeded(status) || id == "" || key == "" {
		return ToolProject{}, fmt.Errorf("seed project: status %d", status)
	}
	return ToolProject{Key: key, ID: id}, nil
}

// mintRestricted makes a read-only key bound to the org's first project, the
// credential an "accepting forbidden input" auth permutation is refused with.
func (seeder *orgSeeder) mintRestricted(ctx context.Context, org ToolOrg) string {
	if len(org.Projects) == 0 {
		return ""
	}
	body := map[string]any{
		"keyType": "service", "name": seeder.options.Tool + "-restricted", "permissionMode": "readonly",
		"bindings": []map[string]any{{"role": "VIEWER", "scopeType": "PROJECT", "scopeId": org.Projects[0].ID}},
	}
	_, minted := seeder.call(ctx, http.MethodPost, "/api/api-keys", bearer(org.OrgKey), body)
	token, _ := minted["token"].(string)
	return token
}

func (seeder *orgSeeder) call(ctx context.Context, method, path string, headers map[string]string, body any) (int, map[string]any) {
	var reader io.Reader
	if body != nil {
		encoded, _ := json.Marshal(body)
		reader = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, seeder.options.BaseURL+path, reader)
	if err != nil {
		return 0, nil
	}
	request.Header.Set("Content-Type", "application/json")
	if seeder.origin != "" {
		request.Header.Set("Origin", seeder.origin) // better-auth CSRF wants the app origin
	}
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	response, err := seeder.client.Do(request)
	if err != nil {
		return 0, nil
	}
	defer func() { _ = response.Body.Close() }()
	raw, _ := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	decoded := map[string]any{}
	_ = json.Unmarshal(raw, &decoded)
	return response.StatusCode, decoded
}

func writeRecord(path string, org ToolOrg) error {
	encoded, err := json.MarshalIndent(org, "", " ")
	if err != nil {
		return err
	}
	staging := path + ".partial"
	if err := os.WriteFile(staging, encoded, 0o600); err != nil {
		return err
	}
	return os.Rename(staging, path)
}

func bearer(token string) map[string]string {
	return map[string]string{"Authorization": "Bearer " + token}
}

func created(status int) bool   { return status == http.StatusOK || status == http.StatusCreated }
func succeeded(status int) bool { return created(status) }
