package paymentsim

import (
	"fmt"
	"math"
	"time"
)

// prorateAlwaysInvoice bills a subscription change's proration at once; the
// other behaviors leave it for the next invoice or skip it.
const prorateAlwaysInvoice = "always_invoice"

// prorationLines prices the change from before to after against the unused part
// of the current period at the given instant: the old quantity is credited and
// the new one charged for the time left, as Stripe's proration does.
func (s *Server) prorationLines(sub *Subscription, before, after []*Item, at int64) []*Line {
	start, end := sub.CurrentPeriodStart, sub.CurrentPeriodEnd
	if end <= start {
		return nil
	}
	if at < start {
		at = start
	}
	if at > end {
		at = end
	}
	left := float64(end-at) / float64(end-start)
	amountOf := func(it *Item) int64 {
		if it == nil || it.Price == nil {
			return 0
		}
		return amountFor(s.st.price(it.Price.ID), orZero(it.Quantity))
	}
	index := func(items []*Item) map[string]*Item {
		out := make(map[string]*Item, len(items))
		for _, it := range items {
			out[it.ID] = it
		}
		return out
	}
	was, now := index(before), index(after)
	var lines []*Line
	line := func(it *Item, amount int64, label string) {
		qty := orZero(it.Quantity)
		lines = append(lines, &Line{
			Amount: amount, Description: optional(fmt.Sprintf("%s (prorated)", label)), Price: it.Price, Proration: true,
			Quantity: ptr(qty), Subscription: &sub.ID, Type: "invoiceitem", Period: Period{Start: at, End: end},
		})
	}
	for _, it := range before {
		next := now[it.ID]
		if next != nil && amountOf(next) == amountOf(it) {
			continue
		}
		line(it, -int64(float64(amountOf(it))*left+0.5), "Unused time on previous quantity")
	}
	for _, it := range after {
		prev := was[it.ID]
		if prev != nil && amountOf(prev) == amountOf(it) {
			continue
		}
		line(it, int64(float64(amountOf(it))*left+0.5), "Remaining time on new quantity")
	}
	return lines
}

// invoiceProrations bills lines on a fresh invoice for sub and collects it.
func (s *Server) invoiceProrations(sub *Subscription, lines []*Line) {
	s.finalize(s.draftProrations(sub, lines))
}

// draftProrations puts lines on a fresh draft that becomes sub's latest invoice.
func (s *Server) draftProrations(sub *Subscription, lines []*Line) *Invoice {
	inv := s.draftInvoice(sub.Customer, sub.Currency, sub.CollectionMethod, nil, nil)
	inv.BillingReason, inv.Subscription = "subscription_update", &sub.ID
	for _, l := range lines {
		s.addLine(inv, l)
	}
	sub.LatestInvoice = ptr(inv.ID)
	return inv
}

// pendingIfIncomplete is payment_behavior's mode that holds item changes as a
// pending update until their proration invoice is paid.
const pendingIfIncomplete = "pending_if_incomplete"

// pendingLifetime is how long Stripe keeps a pending update before discarding it.
const pendingLifetime = 23 * time.Hour

// holdPending bills lines and, since the charge is about to fail, keeps items
// as sub's pending update instead of applying them. It expires after
// pendingLifetime, or at the period end when that comes first, as Stripe does.
func (s *Server) holdPending(sub *Subscription, items []*Item, lines []*Line) {
	inv := s.draftProrations(sub, lines)
	s.billOutstandingUsage(sub, inv)
	expires := min(s.now().Add(pendingLifetime).Unix(), sub.CurrentPeriodEnd)
	sub.PendingUpdate = &PendingUpdate{ExpiresAt: expires, SubscriptionItems: items}
	sub.pendingInvoice = inv.ID
	s.finalize(inv)
}

// billOutstandingUsage moves the metered usage to date onto inv, as Stripe bills it
// on a pending update invoice: the next invoice starts after it, so usage the
// invoice took is lost when the update expires or is voided unpaid.
func (s *Server) billOutstandingUsage(sub *Subscription, inv *Invoice) {
	now := s.now().Unix()
	from := max(sub.CurrentPeriodStart, sub.usageFrom)
	for _, it := range sub.Items.Data {
		if !isMetered(it.Price) {
			continue
		}
		full := s.st.price(it.Price.ID)
		used := s.meteredUsage(full, usageWindow{customer: sub.Customer, from: from, to: now + 1})
		s.addLine(inv, &Line{
			Amount: meteredAmount(full, used), Price: it.Price, Quantity: ptr(int64(math.Round(used))),
			Period: Period{Start: from, End: now + 1}, Subscription: ptr(sub.ID), Type: "subscription",
		})
	}
	sub.usageFrom = now + 1
}

// willHold is whether an update keeps its items pending: it asks for
// pending_if_incomplete, owes money now and the customer's next charge fails.
func (s *Server) willHold(sub *Subscription, p params, lines []*Line) bool {
	var total int64
	for _, l := range lines {
		total += l.Amount
	}
	return p.str("payment_behavior") == pendingIfIncomplete && total > 0 && s.st.failPayments[sub.Customer] != 0
}
