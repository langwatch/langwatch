package seedgen

import (
	"bytes"
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

// Product kinds the door executor sends through main's tRPC as the signed-in account; Input is the
// procedure's input. Ported from tools/upgradelab/seed/product.go.
const (
	KindProductOrg        = "product.org"
	KindProductPrivacy    = "product.privacy"
	KindProductRetention  = "product.retention"
	KindProductAnnotation = "product.annotation"
	KindProductWorkflow   = "product.workflow"
	KindProductSlack      = "product.slack"
	KindProductReport     = "product.report"
	KindProductScenario   = "product.scenario"
	KindProductSuite      = "product.suite"
	// KindRESTDataset and KindRESTPrompt are main's public REST, authenticated by the project key.
	KindRESTDataset = "rest.dataset.create"
	KindRESTPrompt  = "rest.prompt.create"
)

var productPaths = map[string]string{
	KindProductOrg: "onboarding.initializeOrganization", KindProductPrivacy: "dataPrivacy.setForScope",
	KindProductRetention: "dataRetention.setForScope", KindProductAnnotation: "annotation.create",
	KindProductWorkflow: "workflow.create", KindProductSlack: "slackIntegration.create",
	KindProductReport: "dashboards.create", KindProductScenario: "scenarios.create", KindProductSuite: "suites.create",
}

var restPaths = map[string]string{KindRESTDataset: "/api/dataset", KindRESTPrompt: "/api/prompts"}

// DoorKinds are the kinds the door executor adds to the plan's.
func DoorKinds() []string {
	kinds := []string{}
	for kind := range productPaths {
		kinds = append(kinds, kind)
	}
	for kind := range restPaths {
		kinds = append(kinds, kind)
	}
	return kinds
}

func init() { Kinds = append(Kinds, DoorKinds()...) }

var sessionCookie = regexp.MustCompile(`(?:__Secure-)?better-auth\.session_token=[^;]+`)

// TRPCCall is one procedure call as the signed-in account.
type TRPCCall struct {
	Path     string
	Input    any
	Mutation bool
}

// TRPC answers the call's result data, signing in on first use.
func (d *Door) TRPC(ctx context.Context, call TRPCCall) (json.RawMessage, error) {
	path, input, mutation := call.Path, call.Input, call.Mutation
	if err := d.signIn(ctx); err != nil {
		return nil, err
	}
	envelope := map[string]any{"json": input}
	var request *http.Request
	var err error
	if mutation {
		body, _ := json.Marshal(envelope)
		request, err = http.NewRequestWithContext(ctx, http.MethodPost, d.base()+"/api/trpc/"+path, bytes.NewReader(body))
	} else {
		body, _ := json.Marshal(envelope)
		request, err = http.NewRequestWithContext(ctx, http.MethodGet, d.base()+"/api/trpc/"+path+"?input="+url.QueryEscape(string(body)), http.NoBody)
	}
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", d.base())
	request.Header.Set("Cookie", d.cookie)
	text, status, err := d.do(request)
	if err != nil {
		return nil, err
	}
	var answer struct {
		Result struct {
			Data struct{ JSON json.RawMessage }
		}
		Error json.RawMessage
	}
	if err := json.Unmarshal(text, &answer); err == nil && len(answer.Error) > 0 && string(answer.Error) != "null" {
		return nil, fmt.Errorf("%s answered %d: %.300s", path, status, text)
	}
	if status/100 != 2 {
		return nil, fmt.Errorf("%s answered %d: %.300s", path, status, text)
	}
	return answer.Result.Data.JSON, nil
}

func (d *Door) base() string { return strings.TrimRight(d.App, "/") }

func (d *Door) do(request *http.Request) ([]byte, int, error) {
	response, err := d.http().Do(request)
	if err != nil {
		return nil, 0, err
	}
	defer func() { _ = response.Body.Close() }()
	text, err := io.ReadAll(response.Body)
	return text, response.StatusCode, err
}

func (d *Door) signIn(ctx context.Context) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.cookie != "" {
		return nil
	}
	if d.Email == "" {
		return errors.New("the door has no Email and Password to sign in with")
	}
	body, _ := json.Marshal(map[string]string{"email": d.Email, "password": d.Password})
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, d.base()+"/api/auth/sign-in/email", bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", d.base())
	response, err := d.http().Do(request)
	if err != nil {
		return err
	}
	_, _ = io.Copy(io.Discard, response.Body)
	_ = response.Body.Close()
	for _, value := range response.Header.Values("Set-Cookie") {
		d.cookie = cmp.Or(d.cookie, sessionCookie.FindString(value))
	}
	if d.cookie == "" {
		return fmt.Errorf("sign in answered %d with no better-auth session cookie", response.StatusCode)
	}
	return nil
}

// sendProduct sends one tRPC or REST kind; the reply's Refs hold the answer's top-level strings.
func (d *Door) sendProduct(ctx context.Context, action Action) (Reply, error) {
	var data json.RawMessage
	var err error
	if path, ok := productPaths[action.Kind]; ok {
		data, err = d.TRPC(ctx, TRPCCall{Path: path, Input: action.Input, Mutation: true})
	} else {
		data, err = d.rest(ctx, restPaths[action.Kind], action)
	}
	if err != nil {
		return Reply{ID: action.ID, Code: "refused", Retryable: strings.Contains(err.Error(), "answered 5")}, nil
	}
	refs := map[string]string{}
	var fields map[string]any
	if json.Unmarshal(data, &fields) == nil {
		for name, value := range fields {
			if text, ok := value.(string); ok {
				refs[name] = text
			}
		}
	}
	return Reply{ID: action.ID, OK: true, Refs: refs}, nil
}

func (d *Door) rest(ctx context.Context, path string, action Action) (json.RawMessage, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, d.base()+path, bytes.NewReader(action.Input))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Auth-Token", cmp.Or(d.Keys[action.Project], d.Key))
	text, status, err := d.do(request)
	if err != nil {
		return nil, err
	}
	if status/100 != 2 {
		return nil, fmt.Errorf("%s answered %d: %.300s", path, status, text)
	}
	return text, nil
}
