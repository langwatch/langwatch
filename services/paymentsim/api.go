package paymentsim

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type apiFunc func(r *http.Request, p params) (any, error)

// apiRoutes is the Stripe surface the billing module calls, and nothing more.
func (s *Server) apiRoutes(mux *http.ServeMux) {
	routes := map[string]apiFunc{
		"POST /v1/customers":                          s.createCustomer,
		"GET /v1/customers/{id}":                      s.getCustomer,
		"DELETE /v1/customers/{id}":                   s.deleteCustomer,
		"GET /v1/prices":                              s.listPrices,
		"POST /v1/subscriptions":                      s.createSubscription,
		"GET /v1/subscriptions/{id}":                  s.getSubscription,
		"POST /v1/subscriptions/{id}":                 s.updateSubscription,
		"DELETE /v1/subscriptions/{id}":               s.cancelSubscription,
		"POST /v1/checkout/sessions":                  s.createSession,
		"GET /v1/checkout/sessions/{id}/line_items":   s.sessionLines,
		"POST /v1/billing_portal/sessions":            s.createPortal,
		"POST /v1/invoices":                           s.createInvoice,
		"GET /v1/invoices":                            s.listInvoices,
		"GET /v1/invoices/search":                     s.searchInvoices,
		"POST /v1/invoices/create_preview":            s.previewInvoice,
		"GET /v1/invoices/{id}":                       s.getInvoice,
		"POST /v1/invoices/{id}/finalize":             s.finalizeInvoice,
		"POST /v1/invoices/{id}/pay":                  s.payInvoice,
		"POST /v1/invoiceitems":                       s.createInvoiceItem,
		"POST /v1/billing/meter_events":               s.createMeterEvent,
		"GET /v1/billing/meters":                      s.listMeters,
		"GET /v1/billing/meters/{id}/event_summaries": s.meterSummaries,
		"POST /v1/billing/credit_grants":              s.createGrant,
	}
	for pattern, fn := range routes {
		mux.HandleFunc(pattern, s.api(fn))
	}
	mux.HandleFunc("/v1/", s.api(func(r *http.Request, _ params) (any, error) {
		return nil, &apiError{status: http.StatusNotFound, errType: "invalid_request_error", message: "Unrecognized request URL (" + r.Method + ": " + r.URL.Path + "). paymentsim fakes only the calls billing makes."}
	}))
}

// api authenticates as Stripe does, decodes the form, replays an idempotent
// POST and writes Stripe's object or error envelope.
func (s *Server) api(fn apiFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		auth := r.Header.Get("Authorization")
		if !strings.HasPrefix(auth, "Bearer ") || strings.TrimSpace(strings.TrimPrefix(auth, "Bearer ")) == "" {
			writeJSON(w, http.StatusUnauthorized, (&apiError{errType: "invalid_request_error", message: "You did not provide an API key. You need to provide your API key in the Authorization header, using Bearer auth (e.g. 'Authorization: Bearer YOUR_SECRET_KEY')."}).body())
			return
		}
		p, raw, err := readParams(w, r)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, invalid("", "Invalid request body: %v", err).body())
			return
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		w.Header().Set("Request-Id", s.st.id("req"))
		key := r.Header.Get("Idempotency-Key")
		sum := sha256.Sum256([]byte(r.Method + " " + r.URL.Path + "?" + r.URL.RawQuery + "\n" + string(raw)))
		fingerprint := hex.EncodeToString(sum[:])
		if key != "" && r.Method == http.MethodPost {
			if seen, ok := s.st.idempotent[key]; ok {
				if seen.fingerprint != fingerprint {
					writeJSON(w, http.StatusBadRequest, (&apiError{errType: "idempotency_error", message: fmt.Sprintf("Keys for idempotent requests can only be used with the same parameters they were first used with. Try using a key other than '%s' if you meant to execute a different request.", key)}).body())
					return
				}
				w.Header().Set("Idempotent-Replayed", "true")
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(seen.status)
				_, _ = w.Write(seen.body)
				return
			}
		}
		status, out := http.StatusOK, any(nil)
		v, err := fn(r, p)
		if err != nil {
			e := asAPIError(err)
			status, out = e.status, e.body()
		} else {
			out = v
		}
		body, _ := json.Marshal(out)
		if key != "" && r.Method == http.MethodPost && status != http.StatusInternalServerError {
			s.st.idempotent[key] = idem{fingerprint: fingerprint, status: status, body: body}
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write(body)
	}
}

func (s *Server) customer(id string) (*Customer, error) {
	c := s.st.customers[id]
	if c == nil {
		return nil, noSuch("customer", id)
	}
	return c, nil
}

func (s *Server) createCustomer(_ *http.Request, p params) (any, error) {
	c := &Customer{ID: s.st.id("cus"), Object: "customer", Created: s.now().Unix(), Email: optional(p.str("email")), Metadata: p.metadata(), Name: optional(p.str("name"))}
	s.st.customers[c.ID] = c
	return c, nil
}

func (s *Server) getCustomer(r *http.Request, _ params) (any, error) {
	c, err := s.customer(r.PathValue("id"))
	if err != nil {
		return nil, err
	}
	if c.deleted {
		return map[string]any{"id": c.ID, "object": "customer", "deleted": true}, nil
	}
	return c, nil
}

func (s *Server) deleteCustomer(r *http.Request, _ params) (any, error) {
	c, err := s.customer(r.PathValue("id"))
	if err != nil || c.deleted {
		return nil, noSuch("customer", r.PathValue("id"))
	}
	c.deleted = true
	return map[string]any{"id": c.ID, "object": "customer", "deleted": true}, nil
}

// page is Stripe's cursor paging: limit (1..100, default 10) after starting_after.
func page[T any](items []T, idOf func(T) string, p params, url string) (List[T], error) {
	limit := int64(10)
	if p.has("limit") {
		n, ok := p.integer("limit")
		if !ok || n < 1 || n > 100 {
			return List[T]{}, invalid("limit", "Invalid integer: %s", p.str("limit"))
		}
		limit = n
	}
	start := 0
	if after := p.str("starting_after"); after != "" {
		start = -1
		for i, it := range items {
			if idOf(it) == after {
				start = i + 1
			}
		}
		if start < 0 {
			return List[T]{}, invalid("starting_after", "No such object: '%s'", after)
		}
	}
	end := min(start+int(limit), len(items))
	return listOf(append([]T{}, items[start:end]...), end < len(items), url), nil
}

func (s *Server) listPrices(_ *http.Request, p params) (any, error) {
	var out []*Price
	for _, pr := range s.st.prices {
		if !p.has("active") || pr.Active == p.boolean("active") {
			out = append(out, s.st.render(pr, p.expands("data.product"), p.expands("data.tiers")))
		}
	}
	return page(out, func(pr *Price) string { return pr.ID }, p, "/v1/prices")
}

func (s *Server) subscription(id string) (*Subscription, error) {
	sub := s.st.subscriptions[id]
	if sub == nil {
		return nil, noSuch("subscription", id)
	}
	return sub, nil
}

func (s *Server) createSubscription(_ *http.Request, p params) (any, error) {
	cus := p.str("customer")
	if cus == "" {
		return nil, missingParam("customer")
	}
	if _, err := s.customer(cus); err != nil {
		return nil, err
	}
	var days *int64
	if n, ok := p.integer("days_until_due"); ok {
		days = &n
	}
	anchor, _ := p.integer("billing_cycle_anchor")
	sub, _, err := s.newSubscription("", cus, p.objects("items"), p.metadata(), p.str("collection_method"), days, anchor)
	return sub, err
}

func (s *Server) getSubscription(r *http.Request, _ params) (any, error) {
	return s.subscription(r.PathValue("id"))
}

func (s *Server) updateSubscription(r *http.Request, p params) (any, error) {
	sub, err := s.subscription(r.PathValue("id"))
	if err != nil {
		return nil, err
	}
	if sub.Status == "canceled" {
		return nil, invalid("", "A canceled subscription can only update its cancellation_details and metadata.")
	}
	before := fields(sub)
	items, err := s.applyItems(sub.ID, sub.Items.Data, p.objects("items"))
	if err != nil {
		return nil, err
	}
	var prorations []*Line
	if p.str("proration_behavior") == prorateAlwaysInvoice {
		at, ok := p.integer("proration_date")
		if !ok {
			at = s.now().Unix()
		}
		prorations = s.prorationLines(sub, sub.Items.Data, items, at)
	}
	sub.Items.Data = items
	if p.has("cancel_at_period_end") {
		sub.CancelAtPeriodEnd = p.boolean("cancel_at_period_end")
		sub.CancelAt = nil
		if sub.CancelAtPeriodEnd {
			sub.CancelAt = ptr(sub.CurrentPeriodEnd)
		}
	}
	if t := p.sub("billing_thresholds"); t != nil {
		gte, _ := t.integer("amount_gte")
		sub.BillingThresholds = &Thresholds{AmountGte: gte, ResetBillingCycleAnchor: t.boolean("reset_billing_cycle_anchor")}
	}
	for k, v := range p.metadata() {
		sub.Metadata[k] = v
	}
	if diff := changed(before, fields(sub)); len(diff) > 0 {
		s.emit("customer.subscription.updated", sub, diff)
	}
	if len(prorations) > 0 {
		s.invoiceProrations(sub, prorations)
	}
	return sub, nil
}

func (s *Server) cancelSubscription(r *http.Request, _ params) (any, error) {
	sub, err := s.subscription(r.PathValue("id"))
	if err != nil {
		return nil, err
	}
	if sub.Status == "canceled" {
		return nil, invalid("", "This subscription has already been canceled.")
	}
	sub.CancelAtPeriodEnd = false
	s.cancel(sub)
	return sub, nil
}

func (s *Server) createSession(_ *http.Request, p params) (any, error) {
	mode := p.str("mode")
	if mode == "" {
		return nil, missingParam("mode")
	}
	if mode != "subscription" {
		return nil, invalid("mode", "paymentsim fakes subscription checkout only, not mode %q.", mode)
	}
	if p.str("success_url") == "" {
		return nil, missingParam("success_url")
	}
	if cus := p.str("customer"); cus != "" {
		if _, err := s.customer(cus); err != nil {
			return nil, err
		}
	}
	specs := p.objects("line_items")
	if len(specs) == 0 {
		return nil, missingParam("line_items")
	}
	sess := &Session{
		ID: "cs_test_" + strings.TrimPrefix(s.st.id("cs"), "cs_"), Object: "checkout.session", CancelURL: p.str("cancel_url"),
		ClientReferenceID: optional(p.str("client_reference_id")), Created: s.now().Unix(), Currency: optional(p.str("currency")),
		Customer: optional(p.str("customer")), Metadata: p.metadata(), Mode: mode, PaymentStatus: "unpaid", Status: "open",
		SuccessURL: p.str("success_url"), subMeta: p.sub("subscription_data").metadata(),
	}
	sess.anchor, _ = p.sub("subscription_data").integer("billing_cycle_anchor")
	for i, spec := range specs {
		pr := s.st.price(spec.str("price"))
		if pr == nil {
			return nil, noSuch("price", spec.str("price"))
		}
		line := sessionLine{ID: s.st.id("li"), Object: "item", Price: s.st.render(pr, false, false)}
		if q, ok := spec.integer("quantity"); ok {
			line.Quantity = &q
		} else if !isMetered(pr) {
			return nil, missingParam(fmt.Sprintf("line_items[%d][quantity]", i))
		}
		sess.AmountTotal += amountFor(pr, orZero(line.Quantity))
		if sess.Currency == nil {
			sess.Currency = ptr(pr.Currency)
		}
		sess.lines = append(sess.lines, line)
	}
	sess.URL = ptr(s.cfg.PublicURL + "/checkout/" + sess.ID)
	s.st.sessions[sess.ID] = sess
	return sess, nil
}

func (s *Server) sessionLines(r *http.Request, p params) (any, error) {
	sess := s.st.sessions[r.PathValue("id")]
	if sess == nil {
		return nil, noSuch("checkout.session", r.PathValue("id"))
	}
	return page(sess.lines, func(l sessionLine) string { return l.ID }, p, "/v1/checkout/sessions/"+sess.ID+"/line_items")
}

func (s *Server) createPortal(_ *http.Request, p params) (any, error) {
	cus := p.str("customer")
	if cus == "" {
		return nil, missingParam("customer")
	}
	if _, err := s.customer(cus); err != nil {
		return nil, err
	}
	id := s.st.id("bps")
	portal := map[string]any{
		"id": id, "object": "billing_portal.session", "created": s.now().Unix(), "customer": cus, "livemode": false,
		"return_url": optional(p.str("return_url")), "url": s.cfg.PublicURL + "/portal/" + id,
	}
	s.st.portals[id] = portal
	return portal, nil
}

func (s *Server) findInvoice(id string) (*Invoice, error) {
	inv := s.st.invoice(id)
	if inv == nil {
		return nil, noSuch("invoice", id)
	}
	return inv, nil
}

func (s *Server) createInvoice(_ *http.Request, p params) (any, error) {
	cus := p.str("customer")
	if cus == "" {
		return nil, missingParam("customer")
	}
	if _, err := s.customer(cus); err != nil {
		return nil, err
	}
	var days *int64
	if n, ok := p.integer("days_until_due"); ok {
		days = &n
	}
	collection := p.str("collection_method")
	if collection == "send_invoice" && days == nil {
		return nil, invalid("days_until_due", "Missing days_until_due or due_date: required when collection_method is send_invoice.")
	}
	currency := p.str("currency")
	if currency == "" {
		currency = "usd"
	}
	return s.draftInvoice(cus, currency, collection, days, p.metadata()), nil
}

func (s *Server) createInvoiceItem(_ *http.Request, p params) (any, error) {
	if p.str("customer") == "" {
		return nil, missingParam("customer")
	}
	// ponytail: pending items (no invoice) are not held; billing always names the draft.
	inv, err := s.findInvoice(p.str("invoice"))
	if err != nil {
		return nil, err
	}
	if deref(inv.Status) != "draft" {
		return nil, invalid("invoice", "You can only add invoice items to draft invoices.")
	}
	line := &Line{Description: optional(p.str("description")), Metadata: p.metadata(), Type: "invoiceitem", Period: Period{Start: s.now().Unix(), End: s.now().Unix()}}
	amount, hasAmount := p.integer("amount")
	unit, hasUnit := p.integer("unit_amount")
	qty, hasQty := p.integer("quantity")
	switch {
	case hasAmount:
		line.Amount, line.Quantity = amount, ptr(int64(1))
	case hasUnit:
		if !hasQty {
			qty = 1
		}
		line.Amount, line.Quantity = unit*qty, ptr(qty)
	default:
		return nil, missingParam("amount")
	}
	s.addLine(inv, line)
	return map[string]any{"id": line.ID, "object": "invoiceitem", "amount": line.Amount, "currency": inv.Currency, "customer": inv.Customer, "description": line.Description, "invoice": inv.ID, "metadata": line.Metadata, "quantity": line.Quantity}, nil
}

func (s *Server) customerInvoices(p params) []*Invoice {
	var out []*Invoice
	for i := len(s.st.invoices) - 1; i >= 0; i-- {
		inv := s.st.invoices[i]
		if (p.str("customer") == "" || inv.Customer == p.str("customer")) &&
			(p.str("subscription") == "" || deref(inv.Subscription) == p.str("subscription")) &&
			(p.str("status") == "" || deref(inv.Status) == p.str("status")) {
			out = append(out, inv)
		}
	}
	return out
}

// listInvoices answers newest first, as Stripe does.
func (s *Server) listInvoices(_ *http.Request, p params) (any, error) {
	return page(s.customerInvoices(p), func(inv *Invoice) string { return inv.ID }, p, "/v1/invoices")
}

// searchClause is one field:'value' of Stripe's search language.
var searchClause = regexp.MustCompile(`^(customer|subscription|status|metadata\['((?:[^'\\]|\\.)*)'\]):'((?:[^'\\]|\\.)*)'$`)

// searchInvoices understands the AND-joined equality clauses billing writes.
func (s *Server) searchInvoices(_ *http.Request, p params) (any, error) {
	query := strings.TrimSpace(p.str("query"))
	if query == "" {
		return nil, missingParam("query")
	}
	match := func(*Invoice) bool { return true }
	for _, clause := range strings.Split(query, " AND ") {
		m := searchClause.FindStringSubmatch(strings.TrimSpace(clause))
		if m == nil {
			return nil, invalid("query", "paymentsim cannot parse the search clause %q.", clause)
		}
		field, key, want, prev := m[1], unescape(m[2]), unescape(m[3]), match
		match = func(inv *Invoice) bool {
			if !prev(inv) {
				return false
			}
			switch {
			case field == "customer":
				return inv.Customer == want
			case field == "subscription":
				return deref(inv.Subscription) == want
			case field == "status":
				return deref(inv.Status) == want
			}
			return inv.Metadata[key] == want
		}
	}
	var out []*Invoice
	for _, inv := range s.customerInvoices(params{}) {
		if match(inv) {
			out = append(out, inv)
		}
	}
	return map[string]any{"object": "search_result", "data": orNone(out), "has_more": false, "next_page": nil, "url": "/v1/invoices/search"}, nil
}

func orNone(list []*Invoice) []*Invoice {
	if list == nil {
		return []*Invoice{}
	}
	return list
}

func unescape(s string) string {
	return strings.NewReplacer(`\'`, `'`, `\\`, `\`).Replace(s)
}

// previewInvoice prices the next period with the item changes applied.
// ponytail: no proration; amounts are whole periods.
func (s *Server) previewInvoice(_ *http.Request, p params) (any, error) {
	sub, err := s.subscription(p.str("subscription"))
	if err != nil {
		return nil, err
	}
	items, err := s.applyItems(sub.ID, sub.Items.Data, p.sub("subscription_details").objects("items"))
	if err != nil {
		return nil, err
	}
	inv := &Invoice{ID: "upcoming_in_" + sub.ID, Object: "invoice", BillingReason: "upcoming", Currency: sub.Currency, Customer: sub.Customer, Subscription: &sub.ID, Metadata: map[string]string{}, Status: ptr("draft"), Created: s.now().Unix(), CollectionMethod: sub.CollectionMethod}
	inv.Lines = listOf([]*Line{}, false, "/v1/invoices/upcoming/lines")
	if details := p.sub("subscription_details"); details.str("proration_behavior") == prorateAlwaysInvoice {
		at, ok := details.integer("proration_date")
		if !ok {
			at = s.now().Unix()
		}
		for _, l := range s.prorationLines(sub, sub.Items.Data, items, at) {
			inv.Lines.Data = append(inv.Lines.Data, l)
			inv.Subtotal += l.Amount
		}
		inv.Total, inv.AmountDue, inv.AmountRemaining = inv.Subtotal, inv.Subtotal, inv.Subtotal
		return inv, nil
	}
	for _, it := range items {
		qty := orZero(it.Quantity)
		amount := amountFor(s.st.price(it.Price.ID), qty)
		inv.Lines.Data = append(inv.Lines.Data, &Line{ID: "il_tmp_" + it.ID, Object: "line_item", Amount: amount, Currency: inv.Currency, Metadata: map[string]string{}, Price: it.Price, Quantity: ptr(qty), Subscription: &sub.ID, Type: "subscription", Period: Period{Start: sub.CurrentPeriodEnd, End: addInterval(sub.CurrentPeriodEnd, it.Price.Recurring)}})
		inv.Subtotal += amount
	}
	inv.Total, inv.AmountDue, inv.AmountRemaining = inv.Subtotal, inv.Subtotal, inv.Subtotal
	return inv, nil
}

func (s *Server) getInvoice(r *http.Request, _ params) (any, error) {
	return s.findInvoice(r.PathValue("id"))
}

func (s *Server) finalizeInvoice(r *http.Request, _ params) (any, error) {
	inv, err := s.findInvoice(r.PathValue("id"))
	if err != nil {
		return nil, err
	}
	if deref(inv.Status) != "draft" {
		return nil, invalid("", "This invoice is already finalized, you can't re-finalize a non-draft invoice.")
	}
	s.finalize(inv)
	return inv, nil
}

func (s *Server) payInvoice(r *http.Request, p params) (any, error) {
	inv, err := s.findInvoice(r.PathValue("id"))
	if err != nil {
		return nil, err
	}
	if deref(inv.Status) != "open" {
		return nil, invalid("", "Invoice is already %s.", deref(inv.Status))
	}
	if p.boolean("paid_out_of_band") {
		s.markPaid(inv, true)
		return inv, nil
	}
	if !s.charge(inv) {
		return nil, &apiError{status: http.StatusPaymentRequired, errType: "card_error", code: "card_declined", message: "Your card was declined."}
	}
	return inv, nil
}

// maxMeterAge is how far back Stripe accepts a meter event's timestamp.
const maxMeterAge = 35 * 24 * time.Hour

func (s *Server) createMeterEvent(_ *http.Request, p params) (any, error) {
	name, payload := p.str("event_name"), p.sub("payload")
	if name == "" {
		return nil, missingParam("event_name")
	}
	if payload == nil {
		return nil, missingParam("payload")
	}
	value, err := strconv.ParseInt(payload.str("value"), 10, 64)
	if err != nil {
		return nil, invalid("payload[value]", "The value %q in payload[value] must be a whole number.", payload.str("value"))
	}
	now := s.now()
	ts := now.Unix()
	if p.has("timestamp") {
		if ts, _ = p.integer("timestamp"); ts < now.Add(-maxMeterAge).Unix() || ts > now.Add(5*time.Minute).Unix() {
			return nil, invalid("timestamp", "Timestamp must be within the past 35 calendar days and no more than 5 minutes in the future.")
		}
	}
	id := p.str("identifier")
	if id == "" {
		id = s.st.id("mev")
	}
	for _, e := range s.st.meterEvents {
		if e.Identifier == id {
			return nil, &apiError{status: http.StatusBadRequest, errType: "invalid_request_error", code: "resource_already_exists", message: "An event already exists with identifier " + id + "."}
		}
	}
	cus := payload.str("stripe_customer_id")
	s.st.meterEvents = append(s.st.meterEvents, meterEvent{EventName: name, Identifier: id, Customer: cus, Value: value, Timestamp: ts})
	return map[string]any{"object": "billing.meter_event", "created": now.Unix(), "event_name": name, "identifier": id, "livemode": false, "payload": payload, "timestamp": ts}, nil
}

func (s *Server) listMeters(_ *http.Request, p params) (any, error) {
	return page(s.st.meters, func(m *Meter) string { return m.ID }, p, "/v1/billing/meters")
}

// meterSummaries is one summary over [start_time, end_time); both must sit on a minute.
func (s *Server) meterSummaries(r *http.Request, p params) (any, error) {
	m := s.st.meterByID(r.PathValue("id"))
	if m == nil {
		return nil, noSuch("billing.meter", r.PathValue("id"))
	}
	for _, key := range []string{"customer", "start_time", "end_time"} {
		if p.str(key) == "" {
			return nil, missingParam(key)
		}
	}
	start, okStart := p.integer("start_time")
	end, okEnd := p.integer("end_time")
	if !okStart || !okEnd || start%60 != 0 || end%60 != 0 || end <= start {
		return nil, invalid("start_time", "start_time and end_time must be minute-aligned Unix timestamps, with start_time before end_time.")
	}
	summary := map[string]any{
		"id": s.st.id("mtrusg"), "object": "billing.meter_event_summary", "aggregated_value": s.usage(m.EventName, p.str("customer"), start, end),
		"end_time": end, "livemode": false, "meter": m.ID, "start_time": start,
	}
	return listOf([]map[string]any{summary}, false, "/v1/billing/meters/"+m.ID+"/event_summaries"), nil
}

func (s *Server) createGrant(_ *http.Request, p params) (any, error) {
	cus := p.str("customer")
	if cus == "" {
		return nil, missingParam("customer")
	}
	if _, err := s.customer(cus); err != nil {
		return nil, err
	}
	expires, _ := p.integer("expires_at")
	grant := map[string]any{
		"id": s.st.id("credgr"), "object": "billing.credit_grant", "customer": cus, "name": optional(p.str("name")),
		"category": p.str("category"), "amount": p.sub("amount"), "applicability_config": p.sub("applicability_config"),
		"expires_at": expires, "metadata": p.metadata(), "created": s.now().Unix(), "livemode": false,
	}
	s.st.grants = append(s.st.grants, grant)
	return grant, nil
}
