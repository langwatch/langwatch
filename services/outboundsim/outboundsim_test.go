package outboundsim

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"
)

const (
	testQueue  = "https://sqs.eu-west-1.amazonaws.com/000000000000/outboundsim"
	bearerAuth = "Bearer xoxb-secret-token"
)

type rig struct {
	t      *testing.T
	s      *Server
	url    string
	client *http.Client
}

func newRig(t *testing.T, cfg Config) *rig {
	t.Helper()
	s := newServer(cfg, fstest.MapFS{"index.html": {Data: []byte("<div id=root></div>")}})
	s.now = func() time.Time { return time.Date(2026, 10, 9, 10, 0, 0, 0, time.UTC) }
	srv := httptest.NewServer(s.Handler())
	t.Cleanup(srv.Close)
	noFollow := func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &rig{t: t, s: s, url: srv.URL, client: &http.Client{CheckRedirect: noFollow}}
}

type answer struct {
	status int
	header http.Header
	body   string
}

func (g *rig) try(client *http.Client, method, path string, header map[string]string, body string) (answer, error) {
	req, err := http.NewRequestWithContext(g.t.Context(), method, g.url+path, strings.NewReader(body))
	if err != nil {
		g.t.Fatal(err)
	}
	for key, value := range header {
		req.Header.Set(key, value)
	}
	resp, err := client.Do(req)
	if err != nil {
		return answer{}, err
	}
	defer func() { _ = resp.Body.Close() }()
	text, _ := io.ReadAll(resp.Body)
	return answer{resp.StatusCode, resp.Header, string(text)}, nil
}

func (g *rig) do(method, path string, header map[string]string, body string) answer {
	g.t.Helper()
	got, err := g.try(g.client, method, path, header, body)
	if err != nil {
		g.t.Fatal(err)
	}
	return got
}

func (g *rig) post(path, body string) answer { return g.do(http.MethodPost, path, nil, body) }

func (g *rig) postAs(path string, header map[string]string, body string) answer {
	return g.do(http.MethodPost, path, header, body)
}

func (g *rig) records(query string) []Record {
	g.t.Helper()
	var list struct {
		Records []Record `json:"records"`
	}
	decode(g.t, g.do(http.MethodGet, "/_sim/api/records?"+query, nil, "").body, &list)
	return list.Records
}

func (g *rig) one(query string) Record {
	g.t.Helper()
	list := g.records(query)
	if len(list) != 1 {
		g.t.Fatalf("records(%q) = %d records, want 1", query, len(list))
	}
	return list[0]
}

func (g *rig) faultIDs() []string {
	g.t.Helper()
	var list struct {
		Faults []Fault `json:"faults"`
	}
	decode(g.t, g.do(http.MethodGet, "/_sim/api/faults", nil, "").body, &list)
	ids := []string{}
	for _, f := range list.Faults {
		ids = append(ids, f.ID)
	}
	return ids
}

func (g *rig) addFault(body string) answer {
	g.t.Helper()
	return g.post("/_sim/api/faults", body)
}

func (g *rig) setSecret(name, secret string) {
	g.t.Helper()
	expect(g.t, "set receiver status", g.do(http.MethodPut, "/_sim/api/receivers/"+name, nil, `{"secret":"`+secret+`"}`).status, 200)
}

func decode(t *testing.T, text string, v any) {
	t.Helper()
	if err := json.Unmarshal([]byte(text), v); err != nil {
		t.Fatalf("decoding %q: %v", text, err)
	}
}

func asMap(t *testing.T, text string) map[string]any {
	t.Helper()
	out := map[string]any{}
	decode(t, text, &out)
	return out
}

func expect(t *testing.T, name string, got, want any) {
	t.Helper()
	if got != want {
		t.Errorf("%s = %v, want %v", name, got, want)
	}
}

func bearer() map[string]string { return map[string]string{"Authorization": bearerAuth} }

func sign(secret, body string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte("1760000000." + body))
	return "t=1760000000,v1=" + hex.EncodeToString(mac.Sum(nil))
}

func sqsHeader(action string) map[string]string {
	return map[string]string{"X-Amz-Target": sqsTargetPrefix + action, "Content-Type": awsJSONType}
}

// @scenario "A Slack incoming-webhook post becomes a record"
func TestSlackWebhookBecomesRecord(t *testing.T) {
	g := newRig(t, Config{})
	got := g.post("/services/T0SIM/B0SIGNUPS/x", `{"text":"New sign-up","blocks":[{"type":"section"}]}`)
	expect(t, "status", got.status, 200)
	expect(t, "body", got.body, "ok")
	rec := g.one("channel=slack-webhook")
	expect(t, "target", rec.Target, "/services/T0SIM/B0SIGNUPS/x")
	expect(t, "text", rec.Parsed["text"], "New sign-up")
	if rec.Parsed["blocks"] == nil {
		t.Error("the record holds no blocks")
	}
}

// @scenario "A Slack webhook post that is not JSON is refused as Slack refuses it"
func TestSlackWebhookRefusesNonJSON(t *testing.T) {
	g := newRig(t, Config{})
	got := g.post("/services/T0SIM/B0SIGNUPS/x", "not json at all")
	expect(t, "status", got.status, 400)
	expect(t, "body", got.body, "invalid_payload")
	rec := g.one("channel=slack-webhook")
	expect(t, "record body", rec.Body, "not json at all")
	expect(t, "record status", rec.Status, 400)
}

// @scenario "chat.postMessage with a bot token is recorded and answered"
func TestSlackPostMessageIsRecordedAndRedacted(t *testing.T) {
	g := newRig(t, Config{})
	got := g.postAs("/api/chat.postMessage", bearer(), `{"channel":"C0ALERTS","text":"hello"}`)
	reply := asMap(t, got.body)
	expect(t, "ok", reply["ok"], true)
	expect(t, "channel", reply["channel"], "C0ALERTS")
	if ts, _ := reply["ts"].(string); ts == "" {
		t.Error("the answer holds no message timestamp")
	}
	form := g.post("/api/chat.postMessage", "token=xoxb-form-token&channel=general&text=hi")
	expect(t, "form ok", asMap(t, form.body)["ok"], true)
	recs := g.records("channel=slack-api")
	expect(t, "records", len(recs), 2)
	expect(t, "target", recs[1].Target, "chat.postMessage")
	expect(t, "channel", recs[1].Parsed["channel"], "C0ALERTS")
	expect(t, "authorization", recs[1].Headers["Authorization"], redacted)
	if strings.Contains(recs[0].Body, "xoxb-form-token") {
		t.Error("the form token was kept in the record body")
	}
}

// @scenario "conversations.list and auth.test answer from the seeded workspace"
func TestSlackListAndAuthTestAnswerFromTheSeed(t *testing.T) {
	g := newRig(t, Config{})
	list := asMap(t, g.postAs("/api/conversations.list", bearer(), `{}`).body)
	channels, _ := list["channels"].([]any)
	expect(t, "channels", len(channels), 3)
	auth := asMap(t, g.postAs("/api/auth.test", bearer(), `{}`).body)
	expect(t, "team_id", auth["team_id"], "T0SIM")
}

// @scenario "A Web API call without a token fails as Slack fails it"
func TestSlackWithoutTokenIsNotAuthed(t *testing.T) {
	g := newRig(t, Config{})
	got := g.post("/api/chat.postMessage", `{"channel":"C0ALERTS","text":"hello"}`)
	expect(t, "status", got.status, 200)
	reply := asMap(t, got.body)
	expect(t, "ok", reply["ok"], false)
	expect(t, "error", reply["error"], "not_authed")
}

// @scenario "A token that says it is invalid or revoked is refused as Slack refuses it"
func TestSlackRefusesInvalidAndRevokedTokens(t *testing.T) {
	g := newRig(t, Config{})
	for token, want := range map[string]string{"xoxb-invalid-token": "invalid_auth", "xoxb-revoked-token": "token_revoked"} {
		reply := asMap(t, g.postAs("/api/auth.test", map[string]string{"Authorization": "Bearer " + token}, `{}`).body)
		expect(t, "ok", reply["ok"], false)
		expect(t, "error", reply["error"], want)
	}
}

// @scenario "A post to an unknown channel fails as Slack fails it"
func TestSlackUnknownChannel(t *testing.T) {
	g := newRig(t, Config{})
	reply := asMap(t, g.postAs("/api/chat.postMessage", bearer(), `{"channel":"C0NOPE","text":"hello"}`).body)
	expect(t, "ok", reply["ok"], false)
	expect(t, "error", reply["error"], "channel_not_found")
}

// @scenario "An unknown Web API method is refused"
func TestSlackUnknownMethod(t *testing.T) {
	g := newRig(t, Config{})
	got := g.postAs("/api/users.admin.invite", bearer(), `{}`)
	expect(t, "status", got.status, 200)
	expect(t, "error", asMap(t, got.body)["error"], "unknown_method")
	expect(t, "method", g.one("channel=slack-api").Parsed["method"], "users.admin.invite")
}

// @scenario "A webhook delivery becomes a record with its LangWatch headers"
func TestWebhookRecordsLangWatchHeaders(t *testing.T) {
	g := newRig(t, Config{})
	header := map[string]string{
		headerEventID: "evt_1", headerDeliveryID: "del_1", headerAttempt: "2", headerTestFire: "true",
		"Authorization": "Bearer should-not-show",
	}
	expect(t, "status", g.postAs("/hooks/ok", header, `{"type":"trace.created"}`).status, 200)
	rec := g.one("channel=webhook")
	expect(t, "event id", rec.EventID, "evt_1")
	expect(t, "delivery id", rec.Parsed["deliveryId"], "del_1")
	expect(t, "attempt", rec.Parsed["attempt"], float64(2))
	expect(t, "test fire", rec.Parsed["testFire"], "true")
	expect(t, "body", rec.Body, `{"type":"trace.created"}`)
	expect(t, "authorization", rec.Headers["Authorization"], redacted)
}

// @scenario "A registered secret verifies the delivery signature"
func TestWebhookValidSignature(t *testing.T) {
	g := newRig(t, Config{})
	g.setSecret("ok", "whsec_right")
	body := `{"type":"trace.created"}`
	g.postAs("/hooks/ok", map[string]string{headerSignature: sign("whsec_right", body)}, body)
	expect(t, "verdict", g.one("channel=webhook").Signature, SignatureValid)
}

// @scenario "A wrong or missing signature is recorded, not refused"
func TestWebhookInvalidSignatureIsRecordedNotRefused(t *testing.T) {
	g := newRig(t, Config{})
	g.setSecret("ok", "whsec_right")
	body := `{"type":"trace.created"}`
	wrong := g.postAs("/hooks/ok", map[string]string{headerSignature: sign("whsec_other", body)}, body)
	expect(t, "wrong status", wrong.status, 200)
	missing := g.post("/hooks/ok", body)
	expect(t, "missing status", missing.status, 200)
	g.post("/hooks/free", body)
	recs := g.records("channel=webhook")
	expect(t, "wrong verdict", recs[2].Signature, SignatureInvalid)
	expect(t, "missing verdict", recs[1].Signature, SignatureInvalid)
	expect(t, "unregistered verdict", recs[0].Signature, SignatureUnchecked)
}

// @scenario "Retries of one event are grouped"
func TestWebhookRetriesAreGrouped(t *testing.T) {
	g := newRig(t, Config{})
	header := map[string]string{headerEventID: "evt_retry"}
	statuses := []int{}
	for range 3 {
		statuses = append(statuses, g.postAs("/hooks/flaky", header, `{}`).status)
	}
	expect(t, "statuses", fmt.Sprint(statuses), "[503 503 200]")
	var list struct {
		Deliveries []Delivery `json:"deliveries"`
	}
	decode(t, g.do(http.MethodGet, "/_sim/api/deliveries", nil, "").body, &list)
	expect(t, "deliveries", len(list.Deliveries), 1)
	expect(t, "event id", list.Deliveries[0].EventID, "evt_retry")
	expect(t, "attempts", len(list.Deliveries[0].Attempts), 3)
	expect(t, "first attempt", list.Deliveries[0].Attempts[0].Status, 503)
	expect(t, "last attempt", list.Deliveries[0].Attempts[2].Status, 200)
}

// @scenario "A slow receiver outlives the sender's timeout"
func TestWebhookSlowReceiverOutlivesTheSender(t *testing.T) {
	g := newRig(t, Config{})
	g.s.receivers.slowDelay = 2 * time.Second
	impatient := &http.Client{Timeout: 100 * time.Millisecond}
	if _, err := g.try(impatient, http.MethodPost, "/hooks/slow", nil, `{}`); err == nil {
		t.Fatal("the sender should have given up")
	}
	var rec Record
	for range 50 {
		if list := g.records("channel=webhook"); len(list) == 1 {
			rec = list[0]
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	expect(t, "target", rec.Target, "slow")
	expect(t, "latency ms", rec.LatencyMs, int64(2000))
}

// @scenario "A redirecting receiver is recorded"
func TestWebhookRedirectIsRecorded(t *testing.T) {
	g := newRig(t, Config{})
	got := g.post("/hooks/redirect", `{}`)
	expect(t, "status", got.status, 302)
	expect(t, "location", got.header.Get("Location"), "/hooks/ok")
	expect(t, "redirect record", g.one("target=redirect").Status, 302)
	expect(t, "records at the target", len(g.records("target=ok")), 0)
}

// @scenario "A body over the cap is truncated in the record"
func TestWebhookBodyOverTheCapIsTruncated(t *testing.T) {
	g := newRig(t, Config{MaxBodyBytes: 16})
	expect(t, "status", g.post("/hooks/ok", strings.Repeat("a", 100)).status, 200)
	rec := g.one("channel=webhook")
	expect(t, "kept bytes", len(rec.Body), 16)
	expect(t, "truncated", rec.Truncated, true)
}

// @scenario "An SQS SendMessage becomes a record"
func TestSQSSendMessageBecomesRecord(t *testing.T) {
	g := newRig(t, Config{})
	body := `{"QueueUrl":"` + testQueue + `","MessageBody":"hello","MessageAttributes":{"a":{"DataType":"String","StringValue":"b"}}}`
	got := g.postAs("/", sqsHeader("SendMessage"), body)
	expect(t, "status", got.status, 200)
	reply := asMap(t, got.body)
	expect(t, "md5", reply["MD5OfMessageBody"], "5d41402abc4b2a76b9719d911017c592")
	if id, _ := reply["MessageId"].(string); id == "" {
		t.Error("the answer holds no MessageId")
	}
	rec := g.one("channel=sqs")
	expect(t, "queue", rec.Target, testQueue)
	expect(t, "action", rec.Parsed["action"], "SendMessage")
	if rec.Parsed["messageAttributes"] == nil || !strings.Contains(rec.Body, "hello") {
		t.Errorf("the record lacks the attributes or the body: %+v", rec)
	}
}

// @scenario "An SQS action outboundsim does not speak is refused in AWS's shape"
func TestSQSUnsupportedAction(t *testing.T) {
	g := newRig(t, Config{})
	got := g.postAs("/", sqsHeader("ReceiveMessage"), `{"QueueUrl":"`+testQueue+`"}`)
	expect(t, "status", got.status, 400)
	expect(t, "type", asMap(t, got.body)["__type"], "UnsupportedOperation")
	expect(t, "header", got.header.Get("x-amzn-ErrorType"), "UnsupportedOperation")
	expect(t, "action", g.one("channel=sqs").Parsed["action"], "ReceiveMessage")
}

// @scenario "An SQS call in the query protocol is refused"
func TestSQSQueryProtocolIsRefused(t *testing.T) {
	g := newRig(t, Config{})
	got := g.postAs("/000000000000/outboundsim", map[string]string{"Content-Type": "application/x-www-form-urlencoded"},
		"Action=SendMessage&MessageBody=hi")
	expect(t, "status", got.status, 400)
	expect(t, "type", asMap(t, got.body)["__type"], "InvalidAction")
}

// @scenario "A fault answers a chosen status for a channel and target"
func TestFaultAnswersAChosenStatus(t *testing.T) {
	g := newRig(t, Config{})
	added := asMap(t, g.addFault(`{"channel":"webhook","target":"ok","status":500}`).body)
	expect(t, "status", g.post("/hooks/ok", `{}`).status, 500)
	expect(t, "fault id", g.one("channel=webhook").FaultID, added["id"])
	expect(t, "other target", g.post("/hooks/flaky", `{}`).status, 503)
}

// @scenario "A fault adds latency"
func TestFaultAddsLatency(t *testing.T) {
	g := newRig(t, Config{})
	g.addFault(`{"channel":"slack-api","latencyMs":200}`)
	start := time.Now()
	g.postAs("/api/chat.postMessage", bearer(), `{"channel":"C0ALERTS","text":"hi"}`)
	if elapsed := time.Since(start); elapsed < 200*time.Millisecond {
		t.Errorf("answered after %v, want at least 200ms", elapsed)
	}
}

// @scenario "A fault drops the connection"
func TestFaultDropsTheConnection(t *testing.T) {
	g := newRig(t, Config{})
	g.addFault(`{"channel":"sqs","drop":true}`)
	body := `{"QueueUrl":"` + testQueue + `","MessageBody":"hello"}`
	if _, err := g.try(g.client, http.MethodPost, "/", sqsHeader("SendMessage"), body); err == nil {
		t.Fatal("the connection should have been dropped")
	}
	expect(t, "dropped", g.one("channel=sqs").Dropped, true)
}

// @scenario "A fault limited to a number of calls clears itself"
func TestFaultWithTimesClearsItself(t *testing.T) {
	g := newRig(t, Config{})
	g.addFault(`{"channel":"slack-webhook","status":429,"retryAfter":1,"times":2}`)
	statuses := []int{}
	for range 3 {
		got := g.post("/services/T0SIM/B0SIGNUPS/x", `{"text":"x"}`)
		statuses = append(statuses, got.status)
		if got.status == 429 {
			expect(t, "retry-after", got.header.Get("Retry-After"), "1")
		}
	}
	expect(t, "statuses", fmt.Sprint(statuses), "[429 429 200]")
	expect(t, "faults left", len(g.faultIDs()), 0)
}

// @scenario "An invalid fault is refused"
func TestInvalidFaultIsRefused(t *testing.T) {
	g := newRig(t, Config{})
	for field, body := range map[string]string{
		"status":    `{"channel":"webhook","status":99}`,
		"latencyMs": `{"channel":"webhook","status":500,"latencyMs":-1}`,
	} {
		got := g.addFault(body)
		expect(t, field+" status", got.status, 422)
		expect(t, field+" field", asMap(t, got.body)["field"], field)
	}
	expect(t, "faults", len(g.faultIDs()), 0)
}

// @scenario "Faults can be listed and cleared"
func TestFaultsCanBeListedAndCleared(t *testing.T) {
	g := newRig(t, Config{})
	first := asMap(t, g.addFault(`{"status":500}`).body)
	g.addFault(`{"status":502}`)
	expect(t, "listed", len(g.faultIDs()), 2)
	id, _ := first["id"].(string)
	expect(t, "delete status", g.do(http.MethodDelete, "/_sim/api/faults/"+id, nil, "").status, 204)
	expect(t, "left", len(g.faultIDs()), 1)
	expect(t, "unknown id", g.do(http.MethodDelete, "/_sim/api/faults/nope", nil, "").status, 404)
	expect(t, "clear status", g.do(http.MethodDelete, "/_sim/api/faults", nil, "").status, 204)
	expect(t, "after clear", len(g.faultIDs()), 0)
}

// @scenario "The records can be listed, filtered and cleared"
func TestRecordsCanBeListedFilteredAndCleared(t *testing.T) {
	g := newRig(t, Config{})
	g.post("/services/T0SIM/B0SIGNUPS/x", `{"text":"x"}`)
	g.postAs("/hooks/ok", map[string]string{headerEventID: "evt_9"}, `{}`)
	g.postAs("/", sqsHeader("SendMessage"), `{"QueueUrl":"`+testQueue+`","MessageBody":"m"}`)
	all := g.records("")
	expect(t, "all", len(all), 3)
	expect(t, "newest first", all[0].Channel, ChannelSQS)
	expect(t, "by channel", len(g.records("channel=webhook")), 1)
	expect(t, "by target glob", len(g.records("target=/services/*")), 1)
	expect(t, "by event id", g.one("eventId=evt_9").Channel, ChannelWebhook)
	expect(t, "since the future", len(g.records("since=2030-01-01T00:00:00Z")), 0)
	expect(t, "bad since", g.do(http.MethodGet, "/_sim/api/records?since=soon", nil, "").status, 422)
	expect(t, "clear", g.do(http.MethodDelete, "/_sim/api/records", nil, "").status, 204)
	expect(t, "after clear", len(g.records("")), 0)
}

// @scenario "The record store is bounded"
func TestRecordStoreIsBounded(t *testing.T) {
	g := newRig(t, Config{MaxRecords: 3})
	for i := range 4 {
		g.post(fmt.Sprintf("/services/T0SIM/B0SIGNUPS/%d", i), `{"text":"x"}`)
	}
	recs := g.records("")
	expect(t, "kept", len(recs), 3)
	expect(t, "oldest kept", recs[2].Target, "/services/T0SIM/B0SIGNUPS/1")
}

func TestClientReadsAndSteers(t *testing.T) {
	g := newRig(t, Config{})
	c := Client{BaseURL: g.url}
	g.post("/hooks/ok", `{}`)
	recs, err := c.Records(t.Context(), Filter{Channel: ChannelWebhook})
	if err != nil || len(recs) != 1 {
		t.Fatalf("Records = %d, %v", len(recs), err)
	}
	if _, err := c.AddFault(t.Context(), Fault{Status: 500}); err != nil {
		t.Fatal(err)
	}
	faults, err := c.Faults(t.Context())
	if err != nil || len(faults) != 1 {
		t.Fatalf("Faults = %d, %v", len(faults), err)
	}
	if err := c.Clear(t.Context()); err != nil {
		t.Fatal(err)
	}
}
