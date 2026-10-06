package visualdiff

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"sync"
	"time"
)

// The seeded project and admin, the same ids on both refs (apps/tasks storage-seed;
// platform/app/prisma/seed.ts on main); SeededOrganizationID is in edition.go.
const (
	seededProjectID   = "local-dev-project"
	seededAdminUserID = "local-dev-admin-user"
)

// SeedDepartmentName is the one department the seed makes and puts the admin in, so the
// Directory shows its Departments tab and per-row select as a real organization does.
const SeedDepartmentName = "Engineering"

var seedDashboardNames = []string{"Latency overview", "Cost by model", "Evaluation scores", "Error rates"}

// seedWorkflows carry a stored emoji icon, as real workflows do; the list draws a blank box without one.
var seedWorkflows = []struct{ name, icon, description string }{
	{"Support triage", "🎧", "Routes an incoming ticket to the right queue"},
	{"RAG answer check", "🔎", "Grades an answer against its retrieved context"},
	{"Refund policy evaluator", "🧾", "Scores replies against the refund policy"},
	{"Onboarding assistant", "🚀", "Walks a new user through their first project"},
}

// catalogueRequest is one stack's catalogue seeding, as the account the run works as.
type catalogueRequest struct {
	client   *http.Client
	apiURL   string
	key      string
	identity SeedIdentity
}

// seedCatalogue writes what a lived-in project lists: named dashboards, workflows with
// icons, connected agents with a host label or an owner, and a department holding the
// admin. Each part is its own warning when it fails, since the run's other screens hold.
func seedCatalogue(ctx context.Context, request catalogueRequest) []string {
	var warnings []string
	var mutex sync.Mutex
	warn := func(part string, err error) {
		if err == nil {
			return
		}
		mutex.Lock()
		defer mutex.Unlock()
		warnings = append(warnings, fmt.Sprintf("%s not seeded: %v", part, err))
	}
	var group sync.WaitGroup
	group.Go(func() { warn("dashboards", seedDashboards(ctx, request)) })
	group.Go(func() { warn("connected agents", seedConnectedAgents(ctx, request)) })
	group.Go(func() { warn("langy model", seedLangyModel(ctx, request)) })
	group.Go(func() {
		session, err := signInSession(ctx, request)
		if err != nil {
			warn("workflows and department", err)
			return
		}
		warn("workflows", seedNamedWorkflows(ctx, request, session))
		warn("department", seedDepartment(ctx, session))
		warn("annotation scores", seedAnnotationScores(ctx, session))
	})
	group.Wait()
	return warnings
}

// SeedLangyModel is the custom chat model the project offers beside the registry's, the one
// llmsim answers in its Langy echo mode, so the Langy flows can pick it in the model picker.
const SeedLangyModel = "langy-echo"

// SeedAnnotationScoreName is the score metric a fresh project lists, so a queue has a score
// type to pick; the flows that make queues need one and a new project holds none.
const SeedAnnotationScoreName = "Answer quality"

// seedLangyModel adds the echo model to the project's OpenAI provider. The keys are left out
// of the write, so the provider keeps answering with the process's own (llmsim's) credentials.
func seedLangyModel(ctx context.Context, request catalogueRequest) error {
	return post(ctx, request.client, postSpec{
		url: request.apiURL + "/api/model-providers/openai", key: request.key, method: http.MethodPut,
		body: map[string]any{"enabled": true, "customModels": []string{SeedLangyModel}},
	})
}

// seedAnnotationScores makes the project's one score metric if it is not listed yet.
func seedAnnotationScores(ctx context.Context, session *trpcSession) error {
	listed, err := session.query(ctx, "annotationScore.getAll", map[string]any{"projectId": seededProjectID})
	if err != nil {
		return err
	}
	if namedIDs(listed)[SeedAnnotationScoreName] != "" {
		return nil
	}
	_, err = session.mutate(ctx, "annotationScore.upsert", map[string]any{
		"projectId": seededProjectID, "name": SeedAnnotationScoreName, "dataType": "OPTION",
		"description": "How good the answer was", "radioCheckboxOptions": []string{"Good", "Bad"},
	})
	return err
}

// seedDashboards creates the named dashboards the project does not list yet, in order.
func seedDashboards(ctx context.Context, request catalogueRequest) error {
	listed, err := postReading(ctx, request.client, postSpec{url: request.apiURL + "/api/dashboards", key: request.key, method: http.MethodGet})
	if err != nil {
		return err
	}
	known := namedIDs(listed)
	var failures []error
	for _, name := range seedDashboardNames {
		if known[name] != "" {
			continue
		}
		failures = append(failures, post(ctx, request.client, postSpec{url: request.apiURL + "/api/dashboards", key: request.key, body: map[string]any{"name": name}}))
	}
	return errors.Join(failures...)
}

// seedNamedWorkflows creates the workflows the project does not list yet, through the
// Studio's own create (no REST route makes a workflow), each with its icon in the DSL.
func seedNamedWorkflows(ctx context.Context, request catalogueRequest, session *trpcSession) error {
	listed, err := postReading(ctx, request.client, postSpec{url: request.apiURL + "/api/workflows", key: request.key, method: http.MethodGet})
	if err != nil {
		return err
	}
	known := namedIDs(listed)
	var failures []error
	for _, workflow := range seedWorkflows {
		if known[workflow.name] != "" {
			continue
		}
		_, err := session.mutate(ctx, "workflow.create", map[string]any{
			"projectId": seededProjectID, "commitMessage": "Seeded by visualdiff", "dsl": workflowDSL(workflow.name, workflow.icon, workflow.description),
		})
		failures = append(failures, err)
	}
	return errors.Join(failures...)
}

// workflowDSL is an empty Studio graph, an entry and an end, in the shape an export holds.
func workflowDSL(name, icon, description string) map[string]any {
	entry := map[string]any{
		"id": "entry", "type": "entry", "position": map[string]any{"x": 0, "y": 0}, "deletable": false,
		"data": map[string]any{
			"name": "Entry point", "outputs": []any{map[string]any{"identifier": "input", "type": "str"}},
			"entry_selection": "random", "train_size": 0.8, "test_size": 0.2, "seed": 42,
			"dataset": map[string]any{"name": "Draft Dataset", "inline": map[string]any{
				"records":     map[string]any{"input": []any{"Hello world"}},
				"columnTypes": []any{map[string]any{"name": "input", "type": "string"}},
			}},
		},
	}
	end := map[string]any{
		"id": "end", "type": "end", "position": map[string]any{"x": 600, "y": 30}, "deletable": false,
		"data": map[string]any{"name": "End", "inputs": []any{map[string]any{"identifier": "output", "type": "str"}}},
	}
	return map[string]any{
		"spec_version": "1.5", "name": name, "icon": icon, "description": description, "version": "1.0",
		"template_adapter": "default", "workflow_type": "workflow", "enable_tracing": true,
		"nodes": []any{entry, end}, "edges": []any{}, "state": map[string]any{},
	}
}

// seedDepartment makes the department if the organization lacks it, and puts the admin in it.
func seedDepartment(ctx context.Context, session *trpcSession) error {
	scope := map[string]any{"organizationId": SeededOrganizationID}
	listed, err := session.query(ctx, "departments.list", scope)
	if err != nil {
		return err
	}
	id := namedIDs(listed)[SeedDepartmentName]
	if id == "" {
		created, err := session.mutate(ctx, "departments.create", map[string]any{"organizationId": SeededOrganizationID, "name": SeedDepartmentName})
		if err != nil {
			return err
		}
		if id = namedIDs(created)[SeedDepartmentName]; id == "" {
			return errors.New("departments.create answered without the department")
		}
	}
	assign := map[string]any{"organizationId": SeededOrganizationID, "userId": seededAdminUserID, "departmentId": id}
	for attempt := 1; ; attempt++ {
		_, err = session.mutate(ctx, "departments.assignUser", assign)
		if err == nil || attempt == 3 {
			return err
		}
		time.Sleep(time.Second) // the department's projection can trail its create
	}
}

// seedConnectedAgents registers agents the way an SDK process does, over the HTTP
// register route both refs serve. A development agent is host-scoped under the project
// key (the label comes from the hostname) and owner-scoped under the admin's token;
// a production one is shared. Each row outlives its instance, so the cards show their chips.
func seedConnectedAgents(ctx context.Context, request catalogueRequest) error {
	registrations := []struct {
		token, hostname string
		agents          []map[string]any
	}{
		{request.key, "dev-laptop-01", []map[string]any{connectedAgent("Support triage agent", "development")}},
		{SeededPrivateAccessToken, "dev-laptop-02", []map[string]any{connectedAgent("Refund assistant", "development"), connectedAgent("Booking concierge", "production")}},
	}
	var failures []error
	for index, registration := range registrations {
		frame := map[string]any{
			"protocol": 1, "type": "register",
			"sdk": map[string]any{"name": "langwatch", "version": "0.1.0", "language": "python"},
			"instance": map[string]any{
				"id": fmt.Sprintf("visualdiff-instance-%d", index), "hostname": registration.hostname, "username": "visualdiff",
				"pid": 4200 + index, "startedAt": time.Now().UTC().Format(time.RFC3339),
			},
			"agents": registration.agents,
		}
		spec := postSpec{
			url: request.apiURL + "/api/v1/agents/connect/register", bearer: registration.token, body: frame,
			headers: map[string]string{"X-Project-Id": seededProjectID},
		}
		answer, err := postReading(ctx, request.client, spec)
		if err == nil {
			err = refusedRegistration(answer)
		}
		failures = append(failures, err)
	}
	return errors.Join(failures...)
}

func connectedAgent(name, environment string) map[string]any {
	return map[string]any{"name": name, "environment": environment, "parameters": map[string]any{}}
}

// refusedRegistration reports a register answer whose frame is a refusal.
func refusedRegistration(answer []byte) error {
	var parsed struct {
		Frame struct{ Type, Code, Message string }
	}
	if json.Unmarshal(answer, &parsed) == nil && parsed.Frame.Type == "refused" {
		return fmt.Errorf("register refused as %s: %s", parsed.Frame.Code, parsed.Frame.Message)
	}
	return nil
}

// trpcSession is the seeded admin's cookie session for the tRPC writes no REST route covers.
type trpcSession struct {
	client  *http.Client
	apiURL  string
	wrapped bool // main's tRPC reads a superjson envelope; the branch reads plain JSON
}

// signInSession signs in as the run's account, trying the retired seeded emails after it.
func signInSession(ctx context.Context, request catalogueRequest) (*trpcSession, error) {
	jar, err := cookiejar.New(nil)
	if err != nil {
		return nil, err
	}
	client := &http.Client{Timeout: request.client.Timeout, Transport: request.client.Transport, Jar: jar}
	emails := append([]string{request.identity.Email}, request.identity.FallbackEmails...)
	for _, email := range emails {
		spec := postSpec{
			url: request.apiURL + "/api/auth/sign-in/email", headers: map[string]string{"Origin": request.apiURL},
			body: map[string]any{"email": email, "password": request.identity.Password},
		}
		if _, err = postReading(ctx, client, spec); err == nil {
			return &trpcSession{client: client, apiURL: request.apiURL}, nil
		}
	}
	return nil, fmt.Errorf("sign in as %s: %w", request.identity.Email, err)
}

// query runs one procedure as a query (GET); see call.
func (session *trpcSession) query(ctx context.Context, procedure string, input map[string]any) ([]byte, error) {
	return session.call(ctx, trpcCall{procedure: procedure, input: input, query: true})
}

// mutate runs one procedure as a mutation (POST); see call.
func (session *trpcSession) mutate(ctx context.Context, procedure string, input map[string]any) ([]byte, error) {
	return session.call(ctx, trpcCall{procedure: procedure, input: input})
}

// trpcCall is one procedure, its input, and whether it is a query.
type trpcCall struct {
	procedure string
	input     map[string]any
	query     bool
}

// call runs one procedure as a query (GET) or a mutation, in the envelope that last
// answered first and the other after, and keeps the one that worked.
func (session *trpcSession) call(ctx context.Context, request trpcCall) ([]byte, error) {
	procedure, input, query := request.procedure, request.input, request.query
	var err error
	for _, wrapped := range []bool{session.wrapped, !session.wrapped} {
		var body any = input
		if wrapped {
			body = map[string]any{"json": input}
		}
		spec := postSpec{url: session.apiURL + "/api/trpc/" + procedure, headers: map[string]string{"Origin": session.apiURL}, body: body}
		if query {
			encoded, _ := json.Marshal(body)
			spec.url += "?input=" + url.QueryEscape(string(encoded))
			spec.method = http.MethodGet
		}
		var answer []byte
		if answer, err = postReading(ctx, session.client, spec); err == nil {
			session.wrapped = wrapped
			return answer, nil
		}
	}
	return nil, err
}

// namedIDs maps every named thing with an id anywhere in a JSON answer to that id, so a
// list in any wrapper (a bare array, `data`, tRPC's `result.data.json`) reads the same.
func namedIDs(body []byte) map[string]string {
	found := map[string]string{}
	var value any
	if json.Unmarshal(body, &value) != nil {
		return found
	}
	collectNamedIDs(value, found)
	return found
}

// collectNamedIDs walks node, filing every object's id under its name.
func collectNamedIDs(node any, found map[string]string) {
	switch typed := node.(type) {
	case []any:
		for _, item := range typed {
			collectNamedIDs(item, found)
		}
	case map[string]any:
		name, _ := typed["name"].(string)
		id, _ := typed["id"].(string)
		if name != "" && id != "" {
			found[name] = id
		}
		for _, child := range typed {
			collectNamedIDs(child, found)
		}
	}
}
