package apidiff

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Credentials one side mints during the run, never shared with the other:
// each instance verifies only what it issued itself.
const (
	credCLIToken      = "clitoken"      // a device-login access token (/api/auth/cli/exchange)
	credSessionCookie = "sessioncookie" // the seeded admin's browser session
	credLangySession  = "langysession"  // a local Langy session key (control request approve)
	credLangyInstance = "langyinstance" // a connected folder's instance token (connect/register)
)

// sideCredentials are one side's minted credentials, by name.
type sideCredentials map[string]string

// cliDeviceFlowPaths are the device flow's own doors: they authenticate by
// device code, refresh token or browser session, never by the CLI bearer.
var cliDeviceFlowPaths = map[string]bool{
	"/api/auth/cli/device-code": true, "/api/auth/cli/exchange": true, "/api/auth/cli/refresh": true,
	"/api/auth/cli/logout": true, "/api/auth/cli/lookup": true, "/api/auth/cli/approve": true,
	"/api/auth/cli/deny": true,
}

// cliSessionPaths are the browser half of the device flow.
var cliSessionPaths = map[string]bool{
	"/api/auth/cli/lookup": true, "/api/auth/cli/approve": true, "/api/auth/cli/deny": true,
}

const instanceTokenHeader = "X-Agent-Instance-Token"

// sideHeaders is the credential each side is sent for one operation: the
// shared scheme-derived headers, replaced where the operation authenticates
// with something the run minted or provisioned for it.
func (engine *probeEngine) sideHeaders(operation Operation, headers map[string]string) (headersA, headersB map[string]string) {
	keys := engine.options.Keys
	path := operation.Path
	switch {
	case isWidgetPath(path) && keys.WidgetProjectKey != "":
		shared := map[string]string{"X-Auth-Token": keys.WidgetProjectKey}
		return shared, shared
	case strings.HasPrefix(path, "/api/internal/langy/") && keys.LangyInternalSecret != "":
		shared := map[string]string{"Authorization": "Bearer " + keys.LangyInternalSecret}
		return shared, shared
	case path == "/api/langy/control/connect/register":
		return bearerFrom(engine.credsA, credLangySession, headers), bearerFrom(engine.credsB, credLangySession, headers)
	case path == "/api/langy/control/connect/poll" || path == "/api/langy/control/connect/frames":
		return withHeader(headers, instanceTokenHeader, engine.credsA[credLangyInstance]),
			withHeader(headers, instanceTokenHeader, engine.credsB[credLangyInstance])
	case cliSessionPaths[path]:
		return sessionHeaders(engine.credsA, engine.options.A, headers), sessionHeaders(engine.credsB, engine.options.B, headers)
	case strings.HasPrefix(path, "/api/auth/cli/") && !cliDeviceFlowPaths[path]:
		return bearerFrom(engine.credsA, credCLIToken, headers), bearerFrom(engine.credsB, credCLIToken, headers)
	}
	return headers, headers
}

// bearerFrom sends one side's minted credential as its bearer, or the shared
// headers when that side minted none (the refusal is then itself compared).
func bearerFrom(credentials sideCredentials, name string, fallback map[string]string) map[string]string {
	value := credentials[name]
	if value == "" {
		return fallback
	}
	return map[string]string{"Authorization": "Bearer " + value}
}

func withHeader(headers map[string]string, name, value string) map[string]string {
	if value == "" {
		return headers
	}
	merged := make(map[string]string, len(headers)+1)
	for key, existing := range headers {
		merged[key] = existing
	}
	merged[name] = value
	return merged
}

func sessionHeaders(credentials sideCredentials, baseURL string, fallback map[string]string) map[string]string {
	cookie := credentials[credSessionCookie]
	if cookie == "" {
		return fallback
	}
	return map[string]string{"Cookie": cookie, "Origin": browserOrigin(baseURL)}
}

// browserOrigin is the origin an instance trusts: BASE_HOST names localhost,
// while the run addresses it by loopback IP.
func browserOrigin(baseURL string) string {
	return strings.Replace(strings.TrimSuffix(baseURL, "/"), "://127.0.0.1:", "://localhost:", 1)
}

// isWidgetPath names the dashboard-widget family, which the run addresses in
// the widget project only.
func isWidgetPath(path string) bool {
	return strings.Contains(path, "/analytics/dashboard-widgets")
}

// retargetWidgetProject points a widget route's project at the widget project,
// the one project the custom-chart playground flag reaches.
func (engine *probeEngine) retargetWidgetProject(operation Operation, sides ...*resolvedParams) {
	if !isWidgetPath(operation.Path) || engine.options.Keys.WidgetProjectKey == "" {
		return
	}
	for _, side := range sides {
		for name := range side.pathValues {
			if normalizeParamName(name) == "projectid" {
				side.pathValues[name] = fixtureWidgetProjectID
			}
		}
	}
}

// rawResult is one fixture request's outcome, with the response headers a
// session sign-in answers with.
type rawResult struct {
	status int
	header http.Header
	body   map[string]any
}

// fixtureCall is one fixture request, sent outside the probe transcript.
type fixtureCall struct {
	method  string
	url     string
	headers map[string]string
	body    any
}

// fixtureRequest sends one fixture request outside the probe transcript.
func (engine *probeEngine) fixtureRequest(call fixtureCall) rawResult {
	var reader io.Reader
	var encoded []byte
	if call.body != nil {
		encoded, _ = json.Marshal(call.body)
		reader = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(engine.ctx, call.method, call.url, reader)
	if err != nil {
		return rawResult{}
	}
	for name, value := range call.headers {
		request.Header.Set(name, value)
	}
	if encoded != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	request.Header.Set("Accept", "application/json")
	response, err := engine.client.Do(request)
	if err != nil {
		engine.progress("fixture %s %s: %v\n", call.method, call.url, err)
		return rawResult{}
	}
	defer response.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(response.Body, bodyCaptureCap))
	decoded, _ := decodedBody(string(raw)).(map[string]any)
	return rawResult{status: response.StatusCode, header: response.Header, body: decoded}
}

// seededAdminEmails are the seeded admin's address on each layout: the
// branch's under the pinned seed domain, main's fixed one.
var seededAdminEmails = []string{"admin@" + seedEmailDomain, "admin@haven.localhost"}

const seededAdminPassword = "LocalHavenAdmin!2026"

// adminEmailsFor orders the seeded admin addresses for one side: the base
// (main) seeds its fixed address, so it is tried first there and a sign-in
// is never spent on the branch's address it does not know.
func (engine *probeEngine) adminEmailsFor(baseURL string) []string {
	if baseURL == engine.options.B && baseURL != engine.options.A {
		return []string{seededAdminEmails[1], seededAdminEmails[0]}
	}
	return seededAdminEmails
}

// mintCLISession signs the seeded admin in on one side and walks the device
// flow the CLI uses (device-code, approve, exchange), filing the browser
// session and the minted access token into that side's credentials.
func (engine *probeEngine) mintCLISession(baseURL string, credentials sideCredentials) {
	origin := browserOrigin(baseURL)
	for _, email := range engine.adminEmailsFor(baseURL) {
		signIn := engine.fixtureRequest(fixtureCall{method: http.MethodPost, url: baseURL + "/api/auth/sign-in/email",
			headers: map[string]string{"Origin": origin}, body: map[string]any{"email": email, "password": seededAdminPassword}})
		if cookie := cookieHeader(signIn.header); signIn.status == http.StatusOK && cookie != "" {
			credentials[credSessionCookie] = cookie
			break
		}
		engine.progress("fixture sign-in %s as %s: %d\n", baseURL, email, signIn.status)
	}
	if credentials[credSessionCookie] == "" {
		return
	}
	device := engine.fixtureRequest(fixtureCall{method: http.MethodPost, url: baseURL + "/api/auth/cli/device-code", body: map[string]any{}})
	deviceCode, _ := device.body["device_code"].(string)
	userCode, _ := device.body["user_code"].(string)
	approve := engine.fixtureRequest(fixtureCall{method: http.MethodPost, url: baseURL + "/api/auth/cli/approve",
		headers: map[string]string{"Cookie": credentials[credSessionCookie], "Origin": origin},
		body:    map[string]any{"user_code": userCode, "organization_id": seededOrganizationID}})
	exchange := engine.fixtureRequest(fixtureCall{method: http.MethodPost, url: baseURL + "/api/auth/cli/exchange",
		body: map[string]any{"device_code": deviceCode}})
	if token, ok := exchange.body["access_token"].(string); ok && token != "" {
		credentials[credCLIToken] = token
	}
	engine.progress("fixture cli session %s: device-code %d, approve %d, exchange %d, token minted %t\n",
		baseURL, device.status, approve.status, exchange.status, credentials[credCLIToken] != "")
}

// cookieHeader folds a response's Set-Cookie values into one Cookie header.
func cookieHeader(header http.Header) string {
	pairs := make([]string, 0)
	for _, cookie := range (&http.Response{Header: header}).Cookies() {
		if cookie.Value != "" {
			pairs = append(pairs, cookie.Name+"="+cookie.Value)
		}
	}
	return strings.Join(pairs, "; ")
}

// codingAgentSessionID is the session the coding-agent fixture log belongs
// to; it is the seeded {sessionId} every coding-agent session route reads.
const codingAgentSessionID = "apidiff-session"

// ingestCodingAgentLog posts one Claude Code api_request event through the
// OTLP logs door on both sides, so a coding-agent session has events to list.
func (engine *probeEngine) ingestCodingAgentLog() {
	body := codingAgentLogBody(time.Now())
	for _, baseURL := range []string{engine.options.A, engine.options.B} {
		result := engine.fixtureRequest(fixtureCall{method: http.MethodPost, url: baseURL + "/api/otel/v1/logs",
			headers: map[string]string{"X-Auth-Token": engine.options.Keys.ProjectKey}, body: body})
		engine.progress("fixture coding-agent log %s: %d\n", baseURL, result.status)
	}
}

func codingAgentLogBody(at time.Time) map[string]any {
	nanos := strconv.FormatInt(at.UnixNano(), 10)
	intAttribute := func(key string, value int) map[string]any {
		return map[string]any{"key": key, "value": map[string]any{"intValue": strconv.Itoa(value)}}
	}
	return map[string]any{"resourceLogs": []any{map[string]any{
		"resource": map[string]any{"attributes": []any{stringAttribute("service.name", "claude-code")}},
		"scopeLogs": []any{map[string]any{
			"scope": map[string]any{"name": "com.anthropic.claude_code.events"},
			"logRecords": []any{map[string]any{
				"timeUnixNano": nanos, "observedTimeUnixNano": nanos,
				"body": map[string]any{"stringValue": "claude_code.api_request"},
				"attributes": []any{
					stringAttribute("event.name", "claude_code.api_request"),
					stringAttribute("event.timestamp", at.UTC().Format(time.RFC3339Nano)),
					stringAttribute("session.id", codingAgentSessionID),
					stringAttribute("model", "claude-sonnet-4-5"),
					map[string]any{"key": "cost_usd", "value": map[string]any{"doubleValue": 0.01}},
					intAttribute("input_tokens", 10),
					intAttribute("output_tokens", 5),
					intAttribute("duration_ms", 100),
				},
			}},
		}},
	}}}
}

// gatewayRequestID is the fixture gateway request both sides settle; its
// completed spend is the webhook event every events route reads.
const gatewayRequestID = "apidiff-gateway-request"

// emitGatewaySpend posts the admit and confirm commands the AI gateway sends
// when it settles a request, through the gateway's own signed door, so a
// webhook event (and a delivery to the endpoint created first) exists.
func (engine *probeEngine) emitGatewaySpend() {
	secret := engine.options.Keys.GatewayInternalSecret
	if secret == "" {
		return
	}
	body, _ := json.Marshal(gatewaySpendBatch(time.Now()))
	const path = "/api/internal/gateway/spend-commands"
	for _, baseURL := range []string{engine.options.A, engine.options.B} {
		headers := gatewaySignature(secret, signedCall{method: http.MethodPost, path: path, body: body}, time.Now())
		result := engine.fixtureRequest(fixtureCall{method: http.MethodPost, url: baseURL + path, headers: headers, body: json.RawMessage(body)})
		engine.progress("fixture gateway spend %s: %d accepted %v rejected %v\n", baseURL, result.status, result.body["accepted"], result.body["rejected"])
	}
}

func gatewaySpendBatch(at time.Time) map[string]any {
	occurred := at.UnixMilli()
	admit := map[string]any{
		"gateway_request_id": gatewayRequestID, "occurred_at": occurred,
		"organization_id": seededOrganizationID, "project_id": seededProjectID,
		"virtual_key_id": "apidiff-virtual-key", "model": "gpt-5-mini", "model_provider_id": "openai",
		"outcome_carries_attribution": false,
	}
	confirm := map[string]any{
		"gateway_request_id": gatewayRequestID, "occurred_at": occurred + 1000,
		"project_id": seededProjectID, "model": "gpt-5-mini", "model_provider_id": "openai",
		"usage": map[string]any{"input_tokens": 10, "output_tokens": 5}, "duration_ms": 1000,
		"organization_id": seededOrganizationID, "virtual_key_id": "apidiff-virtual-key",
	}
	return map[string]any{"records": []any{
		map[string]any{"command": "admitSpend", "payload": admit, "pod_id": "apidiff", "pod_seq": 1},
		map[string]any{"command": "confirmSpend", "payload": confirm, "pod_id": "apidiff", "pod_seq": 2},
	}}
}

// signedCall is what the gateway's signature covers.
type signedCall struct {
	method string
	path   string
	body   []byte
}

// gatewaySignature signs a request the way the gateway's control-plane
// signer does: hex(hmac_sha256(secret, method\npath\ntimestamp\nsha256(body))).
func gatewaySignature(secret string, call signedCall, at time.Time) map[string]string {
	timestamp := strconv.FormatInt(at.Unix(), 10)
	bodyHash := sha256.Sum256(call.body)
	canonical := call.method + "\n" + call.path + "\n" + timestamp + "\n" + hex.EncodeToString(bodyHash[:])
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(canonical))
	return map[string]string{
		"X-LangWatch-Gateway-Signature": hex.EncodeToString(mac.Sum(nil)),
		"X-LangWatch-Gateway-Timestamp": timestamp,
		"X-LangWatch-Gateway-Node":      "apidiff",
	}
}
