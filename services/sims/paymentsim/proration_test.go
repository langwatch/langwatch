package paymentsim

import (
	"net/http"
	"strconv"
	"testing"
)

// @scenario "A seat change previewed with always_invoice bills exactly what the preview showed"
func TestSeatChangePreviewEqualsTheInvoice(t *testing.T) {
	g := newRig(t)
	_, subID := g.subscribe(2)
	_, sub := g.stripe(http.MethodGet, "/v1/subscriptions/"+subID, "")
	start, end := int64(sub["current_period_start"].(float64)), int64(sub["current_period_end"].(float64))
	half := start + (end-start)/2
	item := sub["items"].(map[string]any)["data"].([]any)[0].(map[string]any)
	itemID := item["id"].(string)

	preview := "subscription=" + subID + "&subscription_details[proration_behavior]=always_invoice" +
		"&subscription_details[proration_date]=" + strconv.FormatInt(half, 10) +
		"&subscription_details[items][0][id]=" + itemID + "&subscription_details[items][0][quantity]=4"
	status, quote := g.stripe(http.MethodPost, "/v1/invoices/create_preview", preview)
	if status != http.StatusOK {
		t.Fatalf("preview %d %v", status, quote)
	}
	due := int64(quote["amount_due"].(float64))
	// two more seats of 3200 for the half of the period left, credit 6400 and charge 12800 halved
	if want := int64(3200); due < want-2 || due > want+2 {
		t.Fatalf("preview amount due %d, want about %d", due, want)
	}

	update := "proration_behavior=always_invoice&proration_date=" + strconv.FormatInt(half, 10) +
		"&items[0][id]=" + itemID + "&items[0][quantity]=4"
	if status, out := g.stripe(http.MethodPost, "/v1/subscriptions/"+subID, update); status != http.StatusOK {
		t.Fatalf("update %d %v", status, out)
	}
	_, list := g.stripe(http.MethodGet, "/v1/invoices", "subscription="+subID+"&limit=1")
	inv := list["data"].([]any)[0].(map[string]any)
	if inv["billing_reason"] != "subscription_update" || inv["status"] != "paid" || int64(inv["total"].(float64)) != due {
		t.Fatalf("proration invoice %v, preview %d", inv, due)
	}
}

func TestSeatReductionPreviewsACredit(t *testing.T) {
	g := newRig(t)
	_, subID := g.subscribe(4)
	_, sub := g.stripe(http.MethodGet, "/v1/subscriptions/"+subID, "")
	itemID := sub["items"].(map[string]any)["data"].([]any)[0].(map[string]any)["id"].(string)
	preview := "subscription=" + subID + "&subscription_details[proration_behavior]=always_invoice" +
		"&subscription_details[items][0][id]=" + itemID + "&subscription_details[items][0][quantity]=2"
	_, quote := g.stripe(http.MethodPost, "/v1/invoices/create_preview", preview)
	if quote["total"].(float64) >= 0 {
		t.Fatalf("a reduction should preview a credit, got %v", quote["total"])
	}
}

// seedEventsPrice puts the metered events price on the rig: 1000 free events, then 2 cents each.
func seedEventsPrice(g *rig) {
	g.control(http.MethodPost, "/_sim/api/prices", `{"id":"price_1T8nfzIMsTw08cudahMR8H7U","product":"prod_U09JyXm95Yad65","currency":"usd","interval":"month","usage_type":"metered","meter":"`+eventsMtr+`","tiers":[{"up_to":1000,"unit_amount":0},{"up_to":null,"unit_amount":2}]}`)
}

// meterEvents sends 1500 billable events for cus.
func meterEvents(g *rig, cus string) {
	for i, v := range []string{"700", "800"} {
		form := "event_name=langwatch_billable_events&payload[stripe_customer_id]=" + cus + "&payload[value]=" + v + "&identifier=pu" + strconv.Itoa(i)
		if status, out := g.stripe(http.MethodPost, "/v1/billing/meter_events", form); status != http.StatusOK {
			g.t.Fatalf("meter event %d %v", status, out)
		}
	}
}

// renewalTotal moves past the period end and answers the renewal invoice's total.
func renewalTotal(g *rig, subID string) int64 {
	g.control(http.MethodPost, "/_sim/api/clock/advance", `{"seconds":2764800}`)
	_, list := g.stripe(http.MethodGet, "/v1/invoices", "subscription="+subID+"&limit=1")
	inv := list["data"].([]any)[0].(map[string]any)
	if inv["billing_reason"] != "subscription_cycle" {
		g.t.Fatalf("latest invoice %v", inv)
	}
	return int64(inv["total"].(float64))
}

// @scenario "A pending update that expires unpaid takes the usage it billed with it"
func TestExpiredPendingUpdateDiscardsItsUsage(t *testing.T) {
	g := newRig(t)
	seedEventsPrice(g)
	cus, subID := g.subscribe(2)
	meterEvents(g, cus)
	g.control(http.MethodPost, "/_sim/api/payment-failures", `{"customer":"`+cus+`","kind":"requires_action"}`)
	_, sub := g.stripe(http.MethodGet, "/v1/subscriptions/"+subID, "")
	itemID := sub["items"].(map[string]any)["data"].([]any)[0].(map[string]any)["id"].(string)
	update := "proration_behavior=always_invoice&payment_behavior=pending_if_incomplete&items[0][id]=" + itemID + "&items[0][quantity]=3"
	if status, out := g.stripe(http.MethodPost, "/v1/subscriptions/"+subID, update); status != http.StatusOK || out["pending_update"] == nil {
		t.Fatalf("update %d %v", status, out)
	}
	_, sub = g.stripe(http.MethodGet, "/v1/subscriptions/"+subID, "")
	_, held := g.stripe(http.MethodGet, "/v1/invoices/"+sub["latest_invoice"].(string), "")
	var usage float64
	for _, l := range held["lines"].(map[string]any)["data"].([]any) {
		if line := l.(map[string]any); line["type"] == "subscription" {
			usage += line["amount"].(float64)
		}
	}
	// (1500 - 1000) events x 2 cents ride on the pending update invoice.
	if usage != 1000 {
		t.Fatalf("usage on the pending update invoice %v, want 1000: %v", usage, held)
	}
	g.control(http.MethodPost, "/_sim/api/clock/advance", `{"seconds":86400}`)
	_, sub = g.stripe(http.MethodGet, "/v1/subscriptions/"+subID, "")
	if sub["pending_update"] != nil {
		t.Fatalf("the pending update outlived its 23h: %v", sub["pending_update"])
	}
	// 2 seats x 3200 and no events: the expired update took them.
	if total := renewalTotal(g, subID); total != 6400 {
		t.Fatalf("renewal total %d, want 6400", total)
	}
}

// @scenario "An invoice of its own with auto_advance off waits for pay and keeps the cycle's usage"
func TestOwnInvoiceLeavesUsageToTheCycle(t *testing.T) {
	g := newRig(t)
	seedEventsPrice(g)
	cus, subID := g.subscribe(2)
	meterEvents(g, cus)
	g.control(http.MethodPost, "/_sim/api/payment-failures", `{"customer":"`+cus+`","kind":"requires_action"}`)
	create := "customer=" + cus + "&currency=usd&collection_method=charge_automatically&auto_advance=false" +
		"&pending_invoice_items_behavior=exclude&automatic_tax[enabled]=false&metadata[langwatch_seats]=3"
	status, inv := g.stripe(http.MethodPost, "/v1/invoices", create)
	if status != http.StatusOK {
		t.Fatalf("create %d %v", status, inv)
	}
	id := inv["id"].(string)
	if status, out := g.stripe(http.MethodPost, "/v1/invoiceitems", "customer="+cus+"&invoice="+id+"&amount=1600&currency=usd"); status != http.StatusOK {
		t.Fatalf("item %d %v", status, out)
	}
	_, inv = g.stripe(http.MethodPost, "/v1/invoices/"+id+"/finalize", "auto_advance=false")
	if inv["status"] != "open" || inv["attempt_count"].(float64) != 0 {
		t.Fatalf("finalizing with auto_advance off charged: %v", inv)
	}
	if status, out := g.stripe(http.MethodPost, "/v1/invoices/"+id+"/pay", ""); status != http.StatusPaymentRequired || out["error"].(map[string]any)["code"] != "invoice_payment_intent_requires_action" {
		t.Fatalf("pay %d %v", status, out)
	}
	if status, out := g.stripe(http.MethodPost, "/v1/invoices/"+id+"/void", ""); status != http.StatusOK || out["status"] != "void" {
		t.Fatalf("void %d %v", status, out)
	}
	// 2 seats x 3200 + (1500 - 1000) events x 2: voiding the seat invoice cost no usage.
	if total := renewalTotal(g, subID); total != 7400 {
		t.Fatalf("renewal total %d, want 7400", total)
	}
}
