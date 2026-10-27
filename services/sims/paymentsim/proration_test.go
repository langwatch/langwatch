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
