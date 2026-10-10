package paymentsim

import (
	"encoding/json"
	"fmt"
	"net/http"
	"reflect"
	"time"
)

// Everything here runs under s.mu.

// emit records an event whose data.object is obj as it stands now.
func (s *Server) emit(typ string, obj any, previous map[string]any) {
	raw, _ := json.Marshal(obj)
	s.hook.add(Event{
		ID: s.st.id("evt"), Object: "event", APIVersion: apiVersion, Created: s.now().Unix(),
		Data: EventData{Object: raw, PreviousAttributes: previous}, PendingWebhooks: 1,
		Request: map[string]any{"id": nil, "idempotency_key": nil}, Type: typ,
	})
}

// fields is obj's top level as JSON values, to diff for previous_attributes.
func fields(obj any) map[string]any {
	raw, _ := json.Marshal(obj)
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	return out
}

// changed is previous_attributes: every top-level field of before that differs in after.
func changed(before, after map[string]any) map[string]any {
	out := map[string]any{}
	for k, v := range before {
		if !reflect.DeepEqual(v, after[k]) {
			out[k] = v
		}
	}
	return out
}

// amountFor prices quantity units: per unit, or through graduated or volume tiers.
func amountFor(p *Price, quantity int64) int64 {
	if p.BillingScheme != "tiered" {
		if p.UnitAmount == nil {
			return 0
		}
		return *p.UnitAmount * quantity
	}
	var total, below int64
	for _, t := range p.tiers {
		top := quantity
		if t.UpTo != nil && *t.UpTo < quantity {
			top = *t.UpTo
		}
		inTier := top - below
		if deref(p.TiersMode) == "volume" {
			if t.UpTo == nil || quantity <= *t.UpTo {
				return orZero(t.UnitAmount)*quantity + orZero(t.FlatAmount)
			}
			continue
		}
		if inTier > 0 {
			total += orZero(t.UnitAmount)*inTier + orZero(t.FlatAmount)
		}
		if t.UpTo == nil || quantity <= *t.UpTo {
			break
		}
		below = *t.UpTo
	}
	return total
}

func orZero(n *int64) int64 {
	if n == nil {
		return 0
	}
	return *n
}

// usage sums a customer's meter events for eventName in [from, to).
func (s *Server) usage(eventName, customer string, from, to int64) int64 {
	var total int64
	for _, e := range s.st.meterEvents {
		if e.EventName == eventName && e.Customer == customer && e.Timestamp >= from && e.Timestamp < to {
			total += e.Value
		}
	}
	return total
}

func (s *Server) meteredUsage(p *Price, customer string, from, to int64) int64 {
	if p.Recurring == nil || p.Recurring.Meter == nil {
		return 0
	}
	if m := s.st.meterByID(*p.Recurring.Meter); m != nil {
		return s.usage(m.EventName, customer, from, to)
	}
	return 0
}

// addInterval moves t on by one billing interval of p.
func addInterval(t int64, r *Recurring) int64 {
	at := time.Unix(t, 0).UTC()
	switch r.Interval {
	case "day":
		at = at.AddDate(0, 0, r.IntervalCount)
	case "week":
		at = at.AddDate(0, 0, 7*r.IntervalCount)
	case "year":
		at = at.AddDate(r.IntervalCount, 0, 0)
	default:
		at = at.AddDate(0, r.IntervalCount, 0)
	}
	return at.Unix()
}

func isMetered(p *Price) bool { return p.Recurring != nil && p.Recurring.UsageType == "metered" }

// applyItems is items[] of a create, update or preview applied to current: an
// entry with an id changes or deletes that item, one without adds a price.
func (s *Server) applyItems(subID string, current []*Item, specs []params) ([]*Item, error) {
	out := make([]*Item, 0, len(current)+len(specs))
	for _, it := range current {
		cp := *it
		out = append(out, &cp)
	}
	for i, spec := range specs {
		if id := spec.str("id"); id != "" {
			idx := -1
			for j, it := range out {
				if it.ID == id {
					idx = j
				}
			}
			if idx < 0 {
				return nil, noSuch("subscription_item", id)
			}
			if spec.boolean("deleted") {
				out = append(out[:idx], out[idx+1:]...)
				continue
			}
			if pid := spec.str("price"); pid != "" {
				p := s.st.price(pid)
				if p == nil {
					return nil, noSuch("price", pid)
				}
				out[idx].Price = s.st.render(p, false, false)
			}
			if q, ok := spec.integer("quantity"); ok {
				out[idx].Quantity = ptr(q)
			}
			continue
		}
		pid := spec.str("price")
		if pid == "" {
			return nil, missingParam(fmt.Sprintf("items[%d][price]", i))
		}
		p := s.st.price(pid)
		if p == nil {
			return nil, noSuch("price", pid)
		}
		item := &Item{ID: s.st.id("si"), Object: "subscription_item", Created: s.now().Unix(), Metadata: spec.metadata(), Price: s.st.render(p, false, false), Subscription: subID}
		if !isMetered(p) {
			q, ok := spec.integer("quantity")
			if !ok {
				q = 1
			}
			item.Quantity = ptr(q)
		}
		out = append(out, item)
	}
	return out, nil
}

// newSubscription starts a subscription for customer over items, billing the first period.
func (s *Server) newSubscription(id, customer string, items []params, meta map[string]string, collection string, daysUntilDue *int64, anchor int64) (*Subscription, *Invoice, error) {
	if collection == "" {
		collection = "charge_automatically"
	}
	now := s.now().Unix()
	if id == "" {
		id = s.st.id("sub")
	}
	sub := &Subscription{
		ID: id, Object: "subscription", CollectionMethod: collection, Created: now, Customer: customer,
		DaysUntilDue: daysUntilDue, Metadata: orEmpty(meta), StartDate: now, Status: "active",
	}
	list, err := s.applyItems(sub.ID, nil, items)
	if err != nil {
		return nil, nil, err
	}
	if len(list) == 0 {
		return nil, nil, missingParam("items")
	}
	sub.Items = listOf(list, false, "/v1/subscription_items?subscription="+sub.ID)
	sub.Currency = list[0].Price.Currency
	end := addInterval(now, list[0].Price.Recurring)
	if anchor > now {
		end = anchor
	}
	sub.CurrentPeriodStart, sub.CurrentPeriodEnd, sub.BillingCycleAnchor = now, end, end
	if anchor <= now {
		sub.BillingCycleAnchor = now
	}
	s.st.subscriptions[sub.ID] = sub
	s.emit("customer.subscription.created", sub, nil)
	inv := s.billPeriod(sub, "subscription_create", now, end, now, now)
	return sub, inv, nil
}

// billPeriod invoices licensed items for [start, end) and metered usage for
// [usedFrom, usedTo), finalizes it and, when charged automatically, tries to pay.
func (s *Server) billPeriod(sub *Subscription, reason string, start, end, usedFrom, usedTo int64) *Invoice {
	inv := s.draftInvoice(sub.Customer, sub.Currency, sub.CollectionMethod, sub.DaysUntilDue, map[string]string{})
	inv.BillingReason, inv.Subscription, inv.PeriodStart, inv.PeriodEnd = reason, ptr(sub.ID), start, end
	for _, it := range sub.Items.Data {
		qty, period := orZero(it.Quantity), Period{Start: start, End: end}
		if isMetered(it.Price) {
			qty, period = s.meteredUsage(s.st.price(it.Price.ID), sub.Customer, usedFrom, usedTo), Period{Start: usedFrom, End: usedTo}
		}
		full := s.st.price(it.Price.ID)
		s.addLine(inv, &Line{Amount: amountFor(full, qty), Price: it.Price, Quantity: ptr(qty), Period: period, Subscription: ptr(sub.ID), Type: "subscription"})
	}
	sub.LatestInvoice = ptr(inv.ID)
	s.finalize(inv)
	return inv
}

func (s *Server) draftInvoice(customer, currency, collection string, daysUntilDue *int64, meta map[string]string) *Invoice {
	now := s.now().Unix()
	if collection == "" {
		collection = "charge_automatically"
	}
	inv := &Invoice{
		ID: s.st.id("in"), Object: "invoice", BillingReason: "manual", CollectionMethod: collection, Created: now,
		Currency: currency, Customer: customer, Metadata: orEmpty(meta), PeriodStart: now, PeriodEnd: now, Status: ptr("draft"),
	}
	inv.Lines = listOf([]*Line{}, false, "/v1/invoices/"+inv.ID+"/lines")
	if collection == "send_invoice" && daysUntilDue != nil {
		inv.DueDate = ptr(now + *daysUntilDue*86400)
	}
	s.st.invoices = append(s.st.invoices, inv)
	return inv
}

func (s *Server) addLine(inv *Invoice, line *Line) {
	line.ID, line.Object, line.Currency, line.Metadata = s.st.id("il"), "line_item", inv.Currency, orEmpty(line.Metadata)
	inv.Lines.Data = append(inv.Lines.Data, line)
	inv.Subtotal += line.Amount
	inv.Total, inv.AmountDue, inv.AmountRemaining = inv.Subtotal, inv.Subtotal, inv.Subtotal
}

// finalize opens a draft; a charge_automatically invoice is attempted at once.
func (s *Server) finalize(inv *Invoice) {
	now := s.now().Unix()
	inv.Status, inv.Number = ptr("open"), ptr(fmt.Sprintf("SIM-%04d", s.st.counters["number"]+1))
	s.st.counters["number"]++
	inv.StatusTransitions.FinalizedAt = ptr(now)
	inv.HostedInvoiceURL, inv.InvoicePDF = ptr(s.cfg.PublicURL+"/invoices/"+inv.ID), ptr(s.cfg.PublicURL+"/invoices/"+inv.ID+"/pdf")
	s.emit("invoice.finalized", inv, nil)
	if inv.CollectionMethod == "charge_automatically" {
		s.charge(inv)
	}
}

// charge tries to collect inv; a failure armed for its customer declines it.
func (s *Server) charge(inv *Invoice) bool {
	inv.Attempted, inv.AttemptCount = true, inv.AttemptCount+1
	if n := s.st.failPayments[inv.Customer]; n != 0 {
		if n > 0 {
			s.st.failPayments[inv.Customer] = n - 1
		}
		s.emit("invoice.payment_failed", inv, nil)
		s.setSubStatus(inv, "past_due")
		return false
	}
	s.markPaid(inv, false)
	s.emit("invoice.payment_succeeded", inv, nil)
	s.setSubStatus(inv, "active")
	return true
}

func (s *Server) markPaid(inv *Invoice, outOfBand bool) {
	inv.Status, inv.Paid, inv.PaidOutOfBand = ptr("paid"), true, outOfBand
	inv.AmountPaid, inv.AmountRemaining = inv.AmountDue, 0
	inv.StatusTransitions.PaidAt = ptr(s.now().Unix())
	s.emit("invoice.paid", inv, nil)
}

// setSubStatus moves inv's subscription to status, firing customer.subscription.updated.
func (s *Server) setSubStatus(inv *Invoice, status string) {
	if inv.Subscription == nil {
		return
	}
	sub := s.st.subscriptions[*inv.Subscription]
	if sub == nil || sub.Status == status || sub.Status == "canceled" {
		return
	}
	if inv.BillingReason == "subscription_create" && status == "past_due" {
		status = "incomplete"
	}
	before := fields(sub)
	sub.Status = status
	s.emit("customer.subscription.updated", sub, changed(before, fields(sub)))
}

// cancel ends sub now and fires customer.subscription.deleted.
func (s *Server) cancel(sub *Subscription) {
	now := s.now().Unix()
	sub.Status, sub.CanceledAt, sub.EndedAt = "canceled", ptr(now), ptr(now)
	if sub.CancelAtPeriodEnd {
		sub.CanceledAt = ptr(sub.CurrentPeriodEnd)
	}
	s.emit("customer.subscription.deleted", sub, nil)
}

// advance moves the clock on by d and renews or ends every subscription whose
// period closed on the way, one period at a time.
func (s *Server) advance(d time.Duration) {
	s.st.offset += d
	now := s.now().Unix()
	for {
		due := s.nextDue(now)
		if due == nil {
			return
		}
		if due.CancelAtPeriodEnd {
			s.cancel(due)
			continue
		}
		before := fields(due)
		start, end := due.CurrentPeriodEnd, addInterval(due.CurrentPeriodEnd, due.Items.Data[0].Price.Recurring)
		usedFrom := due.CurrentPeriodStart
		due.CurrentPeriodStart, due.CurrentPeriodEnd = start, end
		s.emit("customer.subscription.updated", due, changed(before, fields(due)))
		s.billPeriod(due, "subscription_cycle", start, end, usedFrom, start)
	}
}

// nextDue is the live subscription whose period closed first, by id on a tie.
func (s *Server) nextDue(now int64) *Subscription {
	var due *Subscription
	for _, sub := range s.st.subscriptions {
		if sub.Status == "canceled" || sub.Status == "incomplete" || sub.CurrentPeriodEnd > now || len(sub.Items.Data) == 0 {
			continue
		}
		if due == nil || sub.CurrentPeriodEnd < due.CurrentPeriodEnd || (sub.CurrentPeriodEnd == due.CurrentPeriodEnd && sub.ID < due.ID) {
			due = sub
		}
	}
	return due
}

// completeCheckout pays a subscription checkout. checkout.session.completed is
// queued before the subscription's own events so the happy path never leans on a
// retry; replay events through the control API to test any other order. A
// declined card leaves the session open.
func (s *Server) completeCheckout(sess *Session) *apiError {
	if sess.Status != "open" {
		return &apiError{status: http.StatusBadRequest, errType: "invalid_request_error", code: "checkout_session_not_open", message: "This Checkout Session is no longer open."}
	}
	if sess.Customer == nil {
		cus := &Customer{ID: s.st.id("cus"), Object: "customer", Created: s.now().Unix(), Metadata: map[string]string{}}
		s.st.customers[cus.ID] = cus
		sess.Customer = &cus.ID
	}
	if n := s.st.failPayments[*sess.Customer]; n != 0 {
		if n > 0 {
			s.st.failPayments[*sess.Customer] = n - 1
		}
		return &apiError{status: http.StatusPaymentRequired, errType: "card_error", code: "card_declined", message: "Your card was declined."}
	}
	items := make([]params, 0, len(sess.lines))
	for _, l := range sess.lines {
		p := params{"price": l.Price.ID}
		if l.Quantity != nil {
			p["quantity"] = fmt.Sprint(*l.Quantity)
		}
		items = append(items, p)
	}
	subID, invoiceID := s.st.id("sub"), s.st.nextID("in")
	sess.Status, sess.PaymentStatus, sess.Subscription, sess.Invoice = "complete", "paid", &subID, &invoiceID
	s.emit("checkout.session.completed", sess, nil)
	if _, _, err := s.newSubscription(subID, *sess.Customer, items, sess.subMeta, "charge_automatically", nil, sess.anchor); err != nil {
		return asAPIError(err)
	}
	return nil
}

func asAPIError(err error) *apiError {
	if e, ok := err.(*apiError); ok {
		return e
	}
	return &apiError{status: http.StatusInternalServerError, errType: "api_error", message: err.Error()}
}
