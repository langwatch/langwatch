package paymentsim

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

const (
	testSecret = "whsec_test"
	catalog    = "../../enterprise/modules/billing/contract/src/stripe-catalog.json"
	seatPrice  = "price_1SzP11IMsTw08cudRhGETYNa" // GROWTH_SEAT_USD_MONTHLY, 3200 usd
	eventsMtr  = "mtr_test_61UBL0fe0hM4Csg7x41IMsTw08cudQaG"
)

var epoch = time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)

// receiver verifies each delivery as stripe-node's constructEvent does and
// answers 400 on a bad signature, 200 otherwise.
type receiver struct {
	mu       sync.Mutex
	received []Event
	refused  int
}

func verify(header string, payload []byte, secret string, now time.Time) bool {
	var ts int64
	var sigs []string
	for _, part := range strings.Split(header, ",") {
		k, v, _ := strings.Cut(part, "=")
		switch k {
		case "t":
			ts, _ = strconv.ParseInt(v, 10, 64)
		case "v1":
			sigs = append(sigs, v)
		}
	}
	if ts == 0 || now.Unix()-ts > 300 {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(strconv.FormatInt(ts, 10) + "." + string(payload)))
	want := hex.EncodeToString(mac.Sum(nil))
	for _, s := range sigs {
		if hmac.Equal([]byte(s), []byte(want)) {
			return true
		}
	}
	return false
}

func (rc *receiver) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	payload, _ := io.ReadAll(r.Body)
	rc.mu.Lock()
	defer rc.mu.Unlock()
	if !verify(r.Header.Get("Stripe-Signature"), payload, testSecret, epoch) {
		rc.refused++
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	var evt Event
	_ = json.Unmarshal(payload, &evt)
	rc.received = append(rc.received, evt)
}

type rig struct {
	t   *testing.T
	s   *Server
	url string
	rc  *receiver
}

func newRig(t *testing.T) *rig {
	t.Helper()
	rc := &receiver{}
	hook := httptest.NewServer(rc)
	t.Cleanup(hook.Close)
	s, err := NewServer(Config{WebhookURL: hook.URL, WebhookSecret: testSecret, CatalogPath: catalog})
	if err != nil {
		t.Fatal(err)
	}
	s.real = func() time.Time { return epoch }
	srv := httptest.NewServer(s.Handler())
	t.Cleanup(srv.Close)
	return &rig{t: t, s: s, url: srv.URL, rc: rc}
}

// stripe calls the API as the SDK does: bearer key, form body or query.
func (g *rig) stripe(method, path, form string, header ...string) (int, map[string]any) {
	g.t.Helper()
	target, body := g.url+path, strings.NewReader(form)
	if method == http.MethodGet || method == http.MethodDelete {
		target, body = target+"?"+form, strings.NewReader("")
	}
	req, _ := http.NewRequestWithContext(g.t.Context(), method, target, body)
	req.Header.Set("Authorization", "Bearer sk_test_paymentsim")
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	for i := 0; i+1 < len(header); i += 2 {
		req.Header.Set(header[i], header[i+1])
	}
	return g.do(req)
}

func (g *rig) control(method, path, body string) (int, map[string]any) {
	g.t.Helper()
	req, _ := http.NewRequestWithContext(g.t.Context(), method, g.url+path, strings.NewReader(body))
	return g.do(req)
}

func (g *rig) do(req *http.Request) (int, map[string]any) {
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		g.t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out
}

func (g *rig) eventTypes() []string {
	events, _, _ := g.s.hook.snapshot()
	var out []string
	for _, e := range events {
		out = append(out, e.Event.Type)
	}
	return out
}

func (g *rig) eventIDs(typ string) []string {
	events, _, _ := g.s.hook.snapshot()
	var out []string
	for _, e := range events {
		if typ == "" || e.Event.Type == typ {
			out = append(out, e.Event.ID)
		}
	}
	return out
}

func (g *rig) deliver(ids []string, secret string) []any {
	body, _ := json.Marshal(map[string]any{"ids": ids, "signingSecret": secret})
	status, out := g.control(http.MethodPost, "/_sim/api/events/deliver", string(body))
	if status != http.StatusOK {
		g.t.Fatalf("deliver: %d %v", status, out)
	}
	return out["attempts"].([]any)
}

// subscribe checks out seats and returns the customer and subscription ids.
func (g *rig) subscribe(seats int) (string, string) {
	g.t.Helper()
	_, cus := g.stripe(http.MethodPost, "/v1/customers", "email=a%40b.c&name=Acme")
	form := url.Values{
		"mode": {"subscription"}, "customer": {cus["id"].(string)}, "success_url": {"http://app/ok?s={CHECKOUT_SESSION_ID}"},
		"line_items[0][price]": {seatPrice}, "line_items[0][quantity]": {strconv.Itoa(seats)},
		"line_items[1][price]": {"price_1T8nfzIMsTw08cudahMR8H7U"}, "client_reference_id": {"org_1"},
		"subscription_data[metadata][organizationId]": {"org_1"},
	}
	status, sess := g.stripe(http.MethodPost, "/v1/checkout/sessions", form.Encode())
	if status != http.StatusOK {
		g.t.Fatalf("checkout: %d %v", status, sess)
	}
	status, done := g.control(http.MethodPost, "/_sim/api/checkout/"+sess["id"].(string)+"/complete", "")
	if status != http.StatusOK {
		g.t.Fatalf("complete: %d %v", status, done)
	}
	return cus["id"].(string), done["subscription"].(string)
}

// @scenario "A call without an API key is refused as Stripe refuses it"
func TestRefusesCallWithoutKey(t *testing.T) {
	g := newRig(t)
	resp, err := http.Get(g.url + "/v1/prices")
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status %d, want 401", resp.StatusCode)
	}
}

// @scenario "The catalog seeds the product's own price ids"
func TestCatalogSeedsRealPriceIDs(t *testing.T) {
	g := newRig(t)
	_, page := g.stripe(http.MethodGet, "/v1/prices", "limit=100&expand[0]=data.product")
	found := map[string]map[string]any{}
	for _, p := range page["data"].([]any) {
		found[p.(map[string]any)["id"].(string)] = p.(map[string]any)
	}
	seat := found[seatPrice]
	if seat == nil || seat["unit_amount"].(float64) != 3200 || seat["currency"] != "usd" {
		t.Fatalf("seat price %v", seat)
	}
	if product, ok := seat["product"].(map[string]any); !ok || product["object"] != "product" {
		t.Fatalf("product not expanded: %v", seat["product"])
	}
	_, meters := g.stripe(http.MethodGet, "/v1/billing/meters", "limit=10")
	m := meters["data"].([]any)[0].(map[string]any)
	if m["id"] != eventsMtr || m["event_name"] != "langwatch_billable_events" {
		t.Fatalf("meter %v", m)
	}
}

// @scenario "An unknown id answers Stripe's resource_missing error"
func TestUnknownIDIsResourceMissing(t *testing.T) {
	g := newRig(t)
	status, out := g.stripe(http.MethodGet, "/v1/subscriptions/sub_nope", "")
	e := out["error"].(map[string]any)
	if status != http.StatusNotFound || e["code"] != "resource_missing" || e["type"] != "invalid_request_error" {
		t.Fatalf("%d %v", status, out)
	}
}

// @scenario "An idempotent retry replays the first answer"
// @scenario "Reusing an idempotency key with other parameters is refused"
func TestIdempotencyKeys(t *testing.T) {
	g := newRig(t)
	_, first := g.stripe(http.MethodPost, "/v1/customers", "name=A", "Idempotency-Key", "k1")
	_, again := g.stripe(http.MethodPost, "/v1/customers", "name=A", "Idempotency-Key", "k1")
	if first["id"] != again["id"] {
		t.Fatalf("replay made a new customer: %v vs %v", first["id"], again["id"])
	}
	status, out := g.stripe(http.MethodPost, "/v1/customers", "name=B", "Idempotency-Key", "k1")
	if status != http.StatusBadRequest || out["error"].(map[string]any)["type"] != "idempotency_error" {
		t.Fatalf("%d %v", status, out)
	}
}

// @scenario "A checkout session completes into an active subscription"
func TestCheckoutCompletes(t *testing.T) {
	g := newRig(t)
	_, subID := g.subscribe(3)
	status, sub := g.stripe(http.MethodGet, "/v1/subscriptions/"+subID, "")
	if status != http.StatusOK || sub["status"] != "active" || sub["metadata"].(map[string]any)["organizationId"] != "org_1" {
		t.Fatalf("%d %v", status, sub)
	}
	items := sub["items"].(map[string]any)["data"].([]any)
	if len(items) != 2 || items[0].(map[string]any)["quantity"].(float64) != 3 {
		t.Fatalf("items %v", items)
	}
	if _, has := items[1].(map[string]any)["quantity"]; has {
		t.Fatal("a metered item carries no quantity")
	}
	want := "checkout.session.completed,customer.subscription.created,invoice.finalized,invoice.paid,invoice.payment_succeeded"
	if got := strings.Join(g.eventTypes(), ","); got != want {
		t.Fatalf("events %s", got)
	}
	_, lines := g.stripe(http.MethodGet, "/v1/checkout/sessions/cs_test_sim000001/line_items", "")
	if len(lines["data"].([]any)) != 2 {
		t.Fatalf("line items %v", lines)
	}
}

// @scenario "Every event is delivered signed in Stripe's format"
func TestDeliveriesAreSigned(t *testing.T) {
	g := newRig(t)
	g.subscribe(1)
	for _, a := range g.deliver(g.eventIDs(""), "") {
		if a.(map[string]any)["status"].(float64) != 200 {
			t.Fatalf("attempt %v", a)
		}
	}
	if len(g.rc.received) != 5 || g.rc.received[0].APIVersion != apiVersion {
		t.Fatalf("received %d", len(g.rc.received))
	}
}

// @scenario "A delivery signed with the wrong secret is refused by Stripe's verification"
func TestWrongSecretIsRefused(t *testing.T) {
	g := newRig(t)
	g.subscribe(1)
	a := g.deliver(g.eventIDs("checkout.session.completed"), "whsec_wrong")[0].(map[string]any)
	if a["status"].(float64) != 400 || a["signed"] != "other" || g.rc.refused != 1 {
		t.Fatalf("attempt %v refused %d", a, g.rc.refused)
	}
}

// @scenario "A duplicate delivery carries the identical event"
func TestDuplicateDelivery(t *testing.T) {
	g := newRig(t)
	g.subscribe(1)
	id := g.eventIDs("checkout.session.completed")[0]
	g.deliver([]string{id, id}, "")
	if len(g.rc.received) != 2 || g.rc.received[0].ID != g.rc.received[1].ID || string(g.rc.received[0].Data.Object) != string(g.rc.received[1].Data.Object) {
		t.Fatalf("received %v", g.rc.received)
	}
}

// @scenario "Held events are delivered out of order on request"
func TestOutOfOrderDelivery(t *testing.T) {
	g := newRig(t)
	g.control(http.MethodPost, "/_sim/api/webhooks/hold", `{"held":true}`)
	g.subscribe(1)
	ids := g.eventIDs("")
	reversed := make([]string, len(ids))
	for i, id := range ids {
		reversed[len(ids)-1-i] = id
	}
	g.deliver(reversed, "")
	if g.rc.received[0].Type != "invoice.payment_succeeded" || g.rc.received[4].Type != "checkout.session.completed" {
		t.Fatalf("order %v", g.rc.received)
	}
	if _, pending, _ := g.s.hook.snapshot(); len(pending) != 0 {
		t.Fatalf("delivered events stay queued: %v", pending)
	}
}

// @scenario "Advancing the clock renews a subscription and bills its metered usage"
// @scenario "Meter events total exactly per customer"
func TestRenewalBillsUsage(t *testing.T) {
	g := newRig(t)
	g.control(http.MethodPost, "/_sim/api/prices", `{"id":"price_1T8nfzIMsTw08cudahMR8H7U","product":"prod_U09JyXm95Yad65","currency":"usd","interval":"month","usage_type":"metered","meter":"`+eventsMtr+`","tiers":[{"up_to":1000,"unit_amount":0},{"up_to":null,"unit_amount":2}]}`)
	cus, subID := g.subscribe(2)
	for i, v := range []string{"700", "800"} {
		status, out := g.stripe(http.MethodPost, "/v1/billing/meter_events", "event_name=langwatch_billable_events&payload[stripe_customer_id]="+cus+"&payload[value]="+v+"&identifier=u"+strconv.Itoa(i))
		if status != http.StatusOK {
			t.Fatalf("%d %v", status, out)
		}
	}
	_, usage := g.control(http.MethodGet, "/_sim/api/usage?customer="+cus, "")
	total := usage["totals"].([]any)[0].(map[string]any)
	if total["value"].(float64) != 1500 || total["events"].(float64) != 2 {
		t.Fatalf("usage %v", total)
	}
	g.control(http.MethodPost, "/_sim/api/clock/advance", `{"seconds":2764800}`)
	_, list := g.stripe(http.MethodGet, "/v1/invoices", "subscription="+subID+"&limit=1")
	inv := list["data"].([]any)[0].(map[string]any)
	// 2 seats x 3200 + (1500-1000) events x 2
	if inv["billing_reason"] != "subscription_cycle" || inv["total"].(float64) != 7400 || inv["status"] != "paid" {
		t.Fatalf("renewal invoice %v", inv)
	}
}

// @scenario "A forced payment failure fires invoice.payment_failed and marks the subscription past due"
// @scenario "A retried invoice pays and restores the subscription"
func TestPaymentFailureAndRetry(t *testing.T) {
	g := newRig(t)
	cus, subID := g.subscribe(1)
	g.control(http.MethodPost, "/_sim/api/payment-failures", `{"customer":"`+cus+`"}`)
	g.control(http.MethodPost, "/_sim/api/clock/advance", `{"seconds":2764800}`)
	if len(g.eventIDs("invoice.payment_failed")) != 1 {
		t.Fatalf("events %v", g.eventTypes())
	}
	_, sub := g.stripe(http.MethodGet, "/v1/subscriptions/"+subID, "")
	if sub["status"] != "past_due" {
		t.Fatalf("status %v", sub["status"])
	}
	status, inv := g.control(http.MethodPost, "/_sim/api/invoices/"+sub["latest_invoice"].(string)+"/retry", "")
	if status != http.StatusOK || inv["status"] != "paid" || inv["attempt_count"].(float64) != 2 {
		t.Fatalf("%d %v", status, inv)
	}
	_, sub = g.stripe(http.MethodGet, "/v1/subscriptions/"+subID, "")
	if sub["status"] != "active" {
		t.Fatalf("status %v", sub["status"])
	}
}

// @scenario "Cancel at period end ends the subscription when the clock passes it"
func TestCancelAtPeriodEnd(t *testing.T) {
	g := newRig(t)
	_, subID := g.subscribe(1)
	_, sub := g.stripe(http.MethodPost, "/v1/subscriptions/"+subID, "cancel_at_period_end=true")
	if sub["cancel_at_period_end"] != true || sub["status"] != "active" {
		t.Fatalf("%v", sub)
	}
	g.control(http.MethodPost, "/_sim/api/clock/advance", `{"seconds":2764800}`)
	_, sub = g.stripe(http.MethodGet, "/v1/subscriptions/"+subID, "")
	if sub["status"] != "canceled" || len(g.eventIDs("customer.subscription.deleted")) != 1 {
		t.Fatalf("%v %v", sub["status"], g.eventTypes())
	}
}

// @scenario "A repeated meter event identifier is refused"
// @scenario "Event summaries need minute-aligned windows"
func TestMeterRules(t *testing.T) {
	g := newRig(t)
	form := "event_name=langwatch_billable_events&payload[stripe_customer_id]=cus_x&payload[value]=5&identifier=same"
	g.stripe(http.MethodPost, "/v1/billing/meter_events", form)
	status, out := g.stripe(http.MethodPost, "/v1/billing/meter_events", form)
	if status != http.StatusBadRequest || out["error"].(map[string]any)["code"] != "resource_already_exists" {
		t.Fatalf("%d %v", status, out)
	}
	start := epoch.Unix() - 3600
	status, _ = g.stripe(http.MethodGet, "/v1/billing/meters/"+eventsMtr+"/event_summaries", "customer=cus_x&start_time="+strconv.FormatInt(start+1, 10)+"&end_time="+strconv.FormatInt(start+7200, 10))
	if status != http.StatusBadRequest {
		t.Fatalf("unaligned window answered %d", status)
	}
	_, sums := g.stripe(http.MethodGet, "/v1/billing/meters/"+eventsMtr+"/event_summaries", "customer=cus_x&start_time="+strconv.FormatInt(start, 10)+"&end_time="+strconv.FormatInt(start+7200, 10))
	if v := sums["data"].([]any)[0].(map[string]any)["aggregated_value"].(float64); v != 5 {
		t.Fatalf("aggregated %v", v)
	}
}

// @scenario "Tiered prices bill graduated and volume tiers"
func TestTieredAmounts(t *testing.T) {
	up := func(n int64) *int64 { return &n }
	tiers := []Tier{{UpTo: up(10), UnitAmount: up(100)}, {UpTo: nil, UnitAmount: up(50), FlatAmount: up(7)}}
	graduated := &Price{BillingScheme: "tiered", TiersMode: ptr("graduated"), tiers: tiers}
	volume := &Price{BillingScheme: "tiered", TiersMode: ptr("volume"), tiers: tiers}
	if got := amountFor(graduated, 15); got != 10*100+5*50+7 {
		t.Fatalf("graduated %d", got)
	}
	if got := amountFor(volume, 15); got != 15*50+7 {
		t.Fatalf("volume %d", got)
	}
	if got := amountFor(volume, 4); got != 400 {
		t.Fatalf("volume low %d", got)
	}
}

func TestFormDecodesBrackets(t *testing.T) {
	p := params{}
	p.put(splitKey("items[1][price]"), "b")
	p.put(splitKey("items[0][price]"), "a")
	p.put(splitKey("expand[]"), "x")
	p.put(splitKey("expand[]"), "y")
	if items := p.objects("items"); len(items) != 2 || items[0].str("price") != "a" {
		t.Fatalf("items %v", items)
	}
	if e := p.strings("expand"); strings.Join(e, ",") != "x,y" {
		t.Fatalf("expand %v", e)
	}
}
