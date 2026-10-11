package paymentsim

import "fmt"

// prorateAlwaysInvoice bills a subscription change's proration at once; the
// other behaviours leave it for the next invoice or skip it.
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
	inv := s.draftInvoice(sub.Customer, sub.Currency, sub.CollectionMethod, nil, nil)
	inv.BillingReason, inv.Subscription = "subscription_update", &sub.ID
	for _, l := range lines {
		s.addLine(inv, l)
	}
	s.finalize(inv)
}
