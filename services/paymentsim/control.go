package paymentsim

import (
	"encoding/json"
	"fmt"
	"html/template"
	"io"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

// controlRoutes is what a test, haven or a developer drives paymentsim with.
func (s *Server) controlRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /_sim/api/status", s.handleStatus)
	mux.HandleFunc("GET /_sim/api/customers", s.handleCustomers)
	mux.HandleFunc("GET /_sim/api/subscriptions", s.handleSubscriptions)
	mux.HandleFunc("GET /_sim/api/checkout", s.handleSessions)
	mux.HandleFunc("GET /_sim/api/invoices", s.handleInvoices)
	mux.HandleFunc("POST /_sim/api/catalog", s.handleCatalog)
	mux.HandleFunc("POST /_sim/api/prices", s.handleSeedPrice)
	mux.HandleFunc("POST /_sim/api/meters", s.handleSeedMeter)
	mux.HandleFunc("POST /_sim/api/clock/advance", s.handleAdvance)
	mux.HandleFunc("POST /_sim/api/payment-failures", s.handleArmFailure)
	mux.HandleFunc("DELETE /_sim/api/payment-failures", s.handleClearFailures)
	mux.HandleFunc("POST /_sim/api/checkout/{id}/complete", s.handleComplete)
	mux.HandleFunc("POST /_sim/api/invoices/{id}/retry", s.handleRetry)
	mux.HandleFunc("GET /_sim/api/events", s.handleEvents)
	mux.HandleFunc("POST /_sim/api/events/deliver", s.handleDeliver)
	mux.HandleFunc("POST /_sim/api/webhooks/hold", s.handleHold)
	mux.HandleFunc("GET /_sim/api/usage", s.handleUsage)
	mux.HandleFunc("DELETE /_sim/api/state", s.handleReset)
	mux.HandleFunc("GET /checkout/{id}", s.handleCheckoutPage)
	mux.HandleFunc("POST /checkout/{id}", s.handleCheckoutPay)
	mux.HandleFunc("GET /portal/{id}", s.handlePortalPage)
}

func controlError(w http.ResponseWriter, status int, format string, args ...any) {
	writeJSON(w, status, map[string]string{"error": fmt.Sprintf(format, args...)})
}

func decode(w http.ResponseWriter, r *http.Request, into any) bool {
	if err := json.NewDecoder(io.LimitReader(r.Body, maxForm)).Decode(into); err != nil && err != io.EOF {
		controlError(w, http.StatusBadRequest, "the body is not the JSON this call reads: %v", err)
		return false
	}
	return true
}

func (s *Server) handleStatus(w http.ResponseWriter, _ *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, pending, held := s.hook.snapshot()
	writeJSON(w, http.StatusOK, map[string]any{
		"stack": s.cfg.Stack, "now": s.now().Unix(), "offsetSeconds": int64(s.st.offset.Seconds()),
		"webhookUrl": s.cfg.WebhookURL, "held": held, "pending": len(pending),
		"prices": len(s.st.prices), "meters": len(s.st.meters), "customers": len(s.st.customers),
		"subscriptions": len(s.st.subscriptions), "invoices": len(s.st.invoices), "meterEvents": len(s.st.meterEvents),
	})
}

// handleCatalog seeds stripe-catalog.json's prices and meters for ?mode= (default test).
func (s *Server) handleCatalog(w http.ResponseWriter, r *http.Request) {
	raw, err := io.ReadAll(io.LimitReader(r.Body, 8<<20))
	if err != nil {
		controlError(w, http.StatusBadRequest, "%v", err)
		return
	}
	mode := r.URL.Query().Get("mode")
	if mode == "" {
		mode = "test"
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.st.seedCatalog(raw, mode, s.now()); err != nil {
		controlError(w, http.StatusBadRequest, "%v", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"prices": len(s.st.prices), "meters": len(s.st.meters)})
}

func (s *Server) handleSeedPrice(w http.ResponseWriter, r *http.Request) {
	var in PriceSeed
	if !decode(w, r, &in) {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	p, err := s.st.seedPrice(in, s.now().Unix())
	if err != nil {
		controlError(w, http.StatusBadRequest, "%v", err)
		return
	}
	writeJSON(w, http.StatusOK, s.st.render(p, false, true))
}

func (s *Server) handleSeedMeter(w http.ResponseWriter, r *http.Request) {
	var in MeterSeed
	if !decode(w, r, &in) {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	m, err := s.st.seedMeter(in, s.now().Unix())
	if err != nil {
		controlError(w, http.StatusBadRequest, "%v", err)
		return
	}
	writeJSON(w, http.StatusOK, m)
}

// handleAdvance moves the test clock by {"seconds": n} or to {"to": unix}; it never goes back.
func (s *Server) handleAdvance(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Seconds int64 `json:"seconds"`
		To      int64 `json:"to"`
	}
	if !decode(w, r, &in) {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	d := time.Duration(in.Seconds) * time.Second
	if in.To != 0 {
		d = time.Unix(in.To, 0).Sub(s.now())
	}
	if d < 0 {
		controlError(w, http.StatusBadRequest, "the clock only moves forward; it is at %d", s.now().Unix())
		return
	}
	s.advance(d)
	writeJSON(w, http.StatusOK, map[string]int64{"now": s.now().Unix()})
}

// handleArmFailure declines the customer's next {"times"} charges (default 1; -1 is every charge).
func (s *Server) handleArmFailure(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Customer string `json:"customer"`
		Times    int    `json:"times"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.Customer == "" {
		controlError(w, http.StatusBadRequest, "name the customer whose charges should fail")
		return
	}
	if in.Times == 0 {
		in.Times = 1
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.st.failPayments[in.Customer] = in.Times
	writeJSON(w, http.StatusOK, s.st.failPayments)
}

func (s *Server) handleClearFailures(w http.ResponseWriter, _ *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.st.failPayments = map[string]int{}
	writeJSON(w, http.StatusOK, s.st.failPayments)
}

func (s *Server) handleComplete(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess := s.st.sessions[r.PathValue("id")]
	if sess == nil {
		writeJSON(w, http.StatusNotFound, noSuch("checkout.session", r.PathValue("id")).body())
		return
	}
	if err := s.completeCheckout(sess); err != nil {
		writeJSON(w, err.status, err.body())
		return
	}
	writeJSON(w, http.StatusOK, sess)
}

// handleRetry charges an open invoice again, as Stripe's retry schedule would.
func (s *Server) handleRetry(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	inv := s.st.invoice(r.PathValue("id"))
	if inv == nil || deref(inv.Status) != "open" {
		controlError(w, http.StatusBadRequest, "no open invoice %s", r.PathValue("id"))
		return
	}
	s.charge(inv)
	writeJSON(w, http.StatusOK, inv)
}

// handleEvents lists every event with its delivery attempts, optionally ?type=.
func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	events, pending, held := s.hook.snapshot()
	if typ := r.URL.Query().Get("type"); typ != "" {
		kept := events[:0]
		for _, e := range events {
			if e.Event.Type == typ {
				kept = append(kept, e)
			}
		}
		events = kept
	}
	writeJSON(w, http.StatusOK, map[string]any{"events": events, "pending": pending, "held": held})
}

// handleDeliver posts {"ids"} now in that order, signed with {"signingSecret"}
// when given (a wrong one tests the refusal), and answers each attempt.
func (s *Server) handleDeliver(w http.ResponseWriter, r *http.Request) {
	var in struct {
		IDs           []string `json:"ids"`
		SigningSecret string   `json:"signingSecret"`
	}
	if !decode(w, r, &in) {
		return
	}
	if len(in.IDs) == 0 {
		controlError(w, http.StatusBadRequest, "name the event ids to deliver")
		return
	}
	attempts, err := s.hook.deliverNow(r.Context(), in.IDs, in.SigningSecret)
	if err != nil {
		controlError(w, http.StatusBadRequest, "%v", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"attempts": attempts})
}

// handleHold queues events without delivering ({"held": true}) or releases them.
func (s *Server) handleHold(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Held bool `json:"held"`
	}
	if !decode(w, r, &in) {
		return
	}
	s.hook.hold(in.Held)
	writeJSON(w, http.StatusOK, map[string]bool{"held": in.Held})
}

// UsageTotal is one customer's metered total for one event name.
type UsageTotal struct {
	Customer  string `json:"customer"`
	EventName string `json:"event_name"`
	Value     int64  `json:"value"`
	Events    int    `json:"events"`
}

// handleUsage totals accepted meter events per customer and event name; ?customer=
// and ?event_name= filter, ?from= and ?to= bound the timestamps.
func (s *Server) handleUsage(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	from, _ := strconv.ParseInt(q.Get("from"), 10, 64)
	to, err := strconv.ParseInt(q.Get("to"), 10, 64)
	if err != nil {
		to = math.MaxInt64
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	totals := map[[2]string]*UsageTotal{}
	for _, e := range s.st.meterEvents {
		if (q.Get("customer") != "" && e.Customer != q.Get("customer")) || (q.Get("event_name") != "" && e.EventName != q.Get("event_name")) ||
			e.Timestamp < from || e.Timestamp >= to {
			continue
		}
		key := [2]string{e.Customer, e.EventName}
		if totals[key] == nil {
			totals[key] = &UsageTotal{Customer: e.Customer, EventName: e.EventName}
		}
		totals[key].Value += e.Value
		totals[key].Events++
	}
	out := make([]*UsageTotal, 0, len(totals))
	for _, t := range totals {
		out = append(out, t)
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].Customer+"\x00"+out[i].EventName < out[j].Customer+"\x00"+out[j].EventName
	})
	writeJSON(w, http.StatusOK, map[string]any{"totals": out})
}

// handleReset forgets customers, subscriptions, invoices, usage and events; the catalog and clock stay.
func (s *Server) handleReset(w http.ResponseWriter, _ *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.st.reset()
	s.hook.reset()
	writeJSON(w, http.StatusOK, map[string]string{"status": "reset"})
}

var pageTemplate = template.Must(template.New("page").Parse(`<!doctype html><meta charset="utf-8"><title>paymentsim</title>
<body style="font-family:system-ui;max-width:32rem;margin:4rem auto">
<h1>paymentsim {{.Title}}</h1>{{if .Error}}<p style="color:#b00">{{.Error}}</p>{{end}}
<ul>{{range .Lines}}<li>{{.}}</li>{{end}}</ul>
{{if .Action}}<form method="post" action="{{.Action}}"><button>Pay</button></form>{{end}}
{{if .Back}}<p><a href="{{.Back}}">Back</a></p>{{end}}</body>`))

type pageData struct {
	Title, Error, Action, Back string
	Lines                      []string
}

func (s *Server) handleCheckoutPage(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	sess := s.st.sessions[r.PathValue("id")]
	s.mu.Unlock()
	if sess == nil {
		http.NotFound(w, r)
		return
	}
	data := pageData{Title: "checkout", Action: "/checkout/" + sess.ID, Back: sess.CancelURL}
	for _, l := range sess.lines {
		data.Lines = append(data.Lines, fmt.Sprintf("%s × %d", l.Price.ID, orZero(l.Quantity)))
	}
	_ = pageTemplate.Execute(w, data)
}

// handleCheckoutPay completes the session from the page and returns to success_url.
func (s *Server) handleCheckoutPay(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess := s.st.sessions[r.PathValue("id")]
	if sess == nil {
		http.NotFound(w, r)
		return
	}
	if err := s.completeCheckout(sess); err != nil {
		w.WriteHeader(err.status)
		_ = pageTemplate.Execute(w, pageData{Title: "checkout", Error: err.message, Action: "/checkout/" + sess.ID, Back: sess.CancelURL})
		return
	}
	http.Redirect(w, r, strings.ReplaceAll(sess.SuccessURL, "{CHECKOUT_SESSION_ID}", sess.ID), http.StatusSeeOther)
}

func (s *Server) handlePortalPage(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	portal := s.st.portals[r.PathValue("id")]
	s.mu.Unlock()
	if portal == nil {
		http.NotFound(w, r)
		return
	}
	back, _ := portal["return_url"].(*string)
	_ = pageTemplate.Execute(w, pageData{Title: "customer portal", Lines: []string{"customer " + fmt.Sprint(portal["customer"])}, Back: deref(back)})
}

// newestFirst sorts held objects by creation time, latest first, for the console's lists.
func newestFirst[T any](items []T, created func(T) int64, id func(T) string) []T {
	sort.Slice(items, func(i, j int) bool {
		if a, b := created(items[i]), created(items[j]); a != b {
			return a > b
		}
		return id(items[i]) > id(items[j])
	})
	return items
}

// handleCustomers lists the customers that are not deleted, newest first.
func (s *Server) handleCustomers(w http.ResponseWriter, _ *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []Customer{}
	for _, c := range s.st.customers {
		if !c.deleted {
			out = append(out, *c)
		}
	}
	out = newestFirst(out, func(c Customer) int64 { return c.Created }, func(c Customer) string { return c.ID })
	writeJSON(w, http.StatusOK, map[string]any{"customers": out})
}

// handleSubscriptions lists every subscription with its items, newest first.
func (s *Server) handleSubscriptions(w http.ResponseWriter, _ *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Subscription, 0, len(s.st.subscriptions))
	for _, sub := range s.st.subscriptions {
		out = append(out, *sub)
	}
	out = newestFirst(out, func(x Subscription) int64 { return x.Created }, func(x Subscription) string { return x.ID })
	writeJSON(w, http.StatusOK, map[string]any{"subscriptions": out})
}

// handleSessions lists the checkout sessions, newest first.
func (s *Server) handleSessions(w http.ResponseWriter, _ *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Session, 0, len(s.st.sessions))
	for _, sess := range s.st.sessions {
		out = append(out, *sess)
	}
	out = newestFirst(out, func(x Session) int64 { return x.Created }, func(x Session) string { return x.ID })
	writeJSON(w, http.StatusOK, map[string]any{"sessions": out})
}

// handleInvoices lists every invoice, newest first.
func (s *Server) handleInvoices(w http.ResponseWriter, _ *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Invoice, 0, len(s.st.invoices))
	for _, inv := range s.st.invoices {
		out = append(out, *inv)
	}
	out = newestFirst(out, func(x Invoice) int64 { return x.Created }, func(x Invoice) string { return x.ID })
	writeJSON(w, http.StatusOK, map[string]any{"invoices": out})
}
