package paymentsim

import (
	"encoding/json"
	"fmt"
	"sort"
	"time"
)

// Product is Stripe's product object.
type Product struct {
	ID       string            `json:"id"`
	Object   string            `json:"object"`
	Active   bool              `json:"active"`
	Created  int64             `json:"created"`
	Livemode bool              `json:"livemode"`
	Metadata map[string]string `json:"metadata"`
	Name     string            `json:"name"`
}

// Recurring is a price's billing interval and, for metered prices, its meter.
type Recurring struct {
	AggregateUsage *string `json:"aggregate_usage"`
	Interval       string  `json:"interval"`
	IntervalCount  int     `json:"interval_count"`
	Meter          *string `json:"meter"`
	UsageType      string  `json:"usage_type"`
}

// Tier is one band of a tiered price; a nil UpTo is "inf".
type Tier struct {
	FlatAmount *int64 `json:"flat_amount"`
	UnitAmount *int64 `json:"unit_amount"`
	UpTo       *int64 `json:"up_to"`
}

// Price is Stripe's price object. Product is an id, or the product when expanded;
// Tiers is present only when expanded, as Stripe answers.
type Price struct {
	ID            string            `json:"id"`
	Object        string            `json:"object"`
	Active        bool              `json:"active"`
	BillingScheme string            `json:"billing_scheme"`
	Created       int64             `json:"created"`
	Currency      string            `json:"currency"`
	Livemode      bool              `json:"livemode"`
	LookupKey     *string           `json:"lookup_key"`
	Metadata      map[string]string `json:"metadata"`
	Nickname      *string           `json:"nickname"`
	Product       any               `json:"product"`
	Recurring     *Recurring        `json:"recurring"`
	Tiers         []Tier            `json:"tiers,omitempty"`
	TiersMode     *string           `json:"tiers_mode"`
	Type          string            `json:"type"`
	UnitAmount    *int64            `json:"unit_amount"`

	productID string
	tiers     []Tier
}

// Customer is Stripe's customer object.
type Customer struct {
	ID       string            `json:"id"`
	Object   string            `json:"object"`
	Created  int64             `json:"created"`
	Email    *string           `json:"email"`
	Livemode bool              `json:"livemode"`
	Metadata map[string]string `json:"metadata"`
	Name     *string           `json:"name"`

	deleted bool
}

// Item is a subscription item; a metered item carries no quantity.
type Item struct {
	ID           string            `json:"id"`
	Object       string            `json:"object"`
	Created      int64             `json:"created"`
	Metadata     map[string]string `json:"metadata"`
	Price        *Price            `json:"price"`
	Quantity     *int64            `json:"quantity,omitempty"`
	Subscription string            `json:"subscription"`
}

// List is Stripe's list envelope.
type List[T any] struct {
	Object  string `json:"object"`
	Data    []T    `json:"data"`
	HasMore bool   `json:"has_more"`
	URL     string `json:"url"`
}

func listOf[T any](data []T, hasMore bool, url string) List[T] {
	if data == nil {
		data = []T{}
	}
	return List[T]{Object: "list", Data: data, HasMore: hasMore, URL: url}
}

// Thresholds is a subscription's billing threshold.
type Thresholds struct {
	AmountGte               int64 `json:"amount_gte"`
	ResetBillingCycleAnchor bool  `json:"reset_billing_cycle_anchor"`
}

// Subscription is Stripe's subscription object.
type Subscription struct {
	ID                 string            `json:"id"`
	Object             string            `json:"object"`
	BillingCycleAnchor int64             `json:"billing_cycle_anchor"`
	BillingThresholds  *Thresholds       `json:"billing_thresholds"`
	CancelAt           *int64            `json:"cancel_at"`
	CancelAtPeriodEnd  bool              `json:"cancel_at_period_end"`
	CanceledAt         *int64            `json:"canceled_at"`
	CollectionMethod   string            `json:"collection_method"`
	Created            int64             `json:"created"`
	Currency           string            `json:"currency"`
	CurrentPeriodEnd   int64             `json:"current_period_end"`
	CurrentPeriodStart int64             `json:"current_period_start"`
	Customer           string            `json:"customer"`
	DaysUntilDue       *int64            `json:"days_until_due"`
	EndedAt            *int64            `json:"ended_at"`
	Items              List[*Item]       `json:"items"`
	LatestInvoice      *string           `json:"latest_invoice"`
	Livemode           bool              `json:"livemode"`
	Metadata           map[string]string `json:"metadata"`
	StartDate          int64             `json:"start_date"`
	Status             string            `json:"status"`
}

// Line is one invoice line.
type Line struct {
	ID           string            `json:"id"`
	Object       string            `json:"object"`
	Amount       int64             `json:"amount"`
	Currency     string            `json:"currency"`
	Description  *string           `json:"description"`
	Metadata     map[string]string `json:"metadata"`
	Period       Period            `json:"period"`
	Price        *Price            `json:"price"`
	Proration    bool              `json:"proration"`
	Quantity     *int64            `json:"quantity"`
	Subscription *string           `json:"subscription"`
	Type         string            `json:"type"`
}

// Period is a span in Unix seconds.
type Period struct {
	End   int64 `json:"end"`
	Start int64 `json:"start"`
}

// Transitions are the moments an invoice changed status.
type Transitions struct {
	FinalizedAt *int64 `json:"finalized_at"`
	PaidAt      *int64 `json:"paid_at"`
}

// Invoice is Stripe's invoice object.
type Invoice struct {
	ID                string            `json:"id"`
	Object            string            `json:"object"`
	AmountDue         int64             `json:"amount_due"`
	AmountPaid        int64             `json:"amount_paid"`
	AmountRemaining   int64             `json:"amount_remaining"`
	AttemptCount      int64             `json:"attempt_count"`
	Attempted         bool              `json:"attempted"`
	BillingReason     string            `json:"billing_reason"`
	CollectionMethod  string            `json:"collection_method"`
	Created           int64             `json:"created"`
	Currency          string            `json:"currency"`
	Customer          string            `json:"customer"`
	DueDate           *int64            `json:"due_date"`
	HostedInvoiceURL  *string           `json:"hosted_invoice_url"`
	InvoicePDF        *string           `json:"invoice_pdf"`
	Lines             List[*Line]       `json:"lines"`
	Livemode          bool              `json:"livemode"`
	Metadata          map[string]string `json:"metadata"`
	Number            *string           `json:"number"`
	Paid              bool              `json:"paid"`
	PaidOutOfBand     bool              `json:"paid_out_of_band"`
	PeriodEnd         int64             `json:"period_end"`
	PeriodStart       int64             `json:"period_start"`
	Status            *string           `json:"status"`
	StatusTransitions Transitions       `json:"status_transitions"`
	Subscription      *string           `json:"subscription"`
	Subtotal          int64             `json:"subtotal"`
	Total             int64             `json:"total"`
}

// Session is a checkout session; its line items are read through their own list.
type Session struct {
	ID                string            `json:"id"`
	Object            string            `json:"object"`
	AmountTotal       int64             `json:"amount_total"`
	CancelURL         string            `json:"cancel_url"`
	ClientReferenceID *string           `json:"client_reference_id"`
	Created           int64             `json:"created"`
	Currency          *string           `json:"currency"`
	Customer          *string           `json:"customer"`
	Invoice           *string           `json:"invoice"`
	Livemode          bool              `json:"livemode"`
	Metadata          map[string]string `json:"metadata"`
	Mode              string            `json:"mode"`
	PaymentLink       *string           `json:"payment_link"`
	PaymentStatus     string            `json:"payment_status"`
	Status            string            `json:"status"`
	Subscription      *string           `json:"subscription"`
	SuccessURL        string            `json:"success_url"`
	URL               *string           `json:"url"`

	lines   []sessionLine
	subMeta map[string]string
	anchor  int64
}

type sessionLine struct {
	ID       string `json:"id"`
	Object   string `json:"object"`
	Price    *Price `json:"price"`
	Quantity *int64 `json:"quantity"`
}

// Meter is a billing meter.
type Meter struct {
	ID                 string         `json:"id"`
	Object             string         `json:"object"`
	Created            int64          `json:"created"`
	CustomerMapping    map[string]any `json:"customer_mapping"`
	DefaultAggregation map[string]any `json:"default_aggregation"`
	DisplayName        string         `json:"display_name"`
	EventName          string         `json:"event_name"`
	Livemode           bool           `json:"livemode"`
	Status             string         `json:"status"`
	ValueSettings      map[string]any `json:"value_settings"`
}

// meterEvent is one accepted meter event.
type meterEvent struct {
	EventName  string `json:"event_name"`
	Identifier string `json:"identifier"`
	Customer   string `json:"customer"`
	Value      int64  `json:"value"`
	Timestamp  int64  `json:"timestamp"`
}

// idem is one remembered idempotent answer.
type idem struct {
	fingerprint string
	status      int
	body        []byte
}

type state struct {
	counters      map[string]int
	idBase        int
	offset        time.Duration
	products      map[string]*Product
	prices        []*Price
	customers     map[string]*Customer
	subscriptions map[string]*Subscription
	invoices      []*Invoice
	sessions      map[string]*Session
	portals       map[string]map[string]any
	meters        []*Meter
	meterEvents   []meterEvent
	grants        []map[string]any
	idempotent    map[string]idem
	failPayments  map[string]int
}

func newState() *state {
	return &state{
		counters: map[string]int{}, products: map[string]*Product{}, customers: map[string]*Customer{},
		subscriptions: map[string]*Subscription{}, sessions: map[string]*Session{}, portals: map[string]map[string]any{},
		idempotent: map[string]idem{}, failPayments: map[string]int{},
	}
}

// reset forgets everything but the catalog (products, prices, meters) and the clock.
func (st *state) reset() {
	fresh := newState()
	fresh.products, fresh.prices, fresh.meters, fresh.offset = st.products, st.prices, st.meters, st.offset
	fresh.counters, fresh.idBase = st.counters, st.idBase
	*st = *fresh
}

// id is the next id for prefix: cus_sim000001, sub_sim000001, ... counted from idBase.
func (st *state) id(prefix string) string {
	st.counters[prefix]++
	return st.idAt(prefix, st.counters[prefix])
}

// nextID is the id the next call to id(prefix) returns.
func (st *state) nextID(prefix string) string { return st.idAt(prefix, st.counters[prefix]+1) }

func (st *state) idAt(prefix string, n int) string {
	return fmt.Sprintf("%s_sim%06d", prefix, st.idBase+n)
}

func (st *state) price(id string) *Price {
	for _, p := range st.prices {
		if p.ID == id {
			return p
		}
	}
	return nil
}

func (st *state) invoice(id string) *Invoice {
	for _, inv := range st.invoices {
		if inv.ID == id {
			return inv
		}
	}
	return nil
}

func (st *state) meterByID(id string) *Meter {
	for _, m := range st.meters {
		if m.ID == id {
			return m
		}
	}
	return nil
}

// render is the price as the API answers it: product id or object, tiers when expanded.
func (st *state) render(p *Price, expandProduct, expandTiers bool) *Price {
	out := *p
	out.Product = p.productID
	if expandProduct && st.products[p.productID] != nil {
		out.Product = st.products[p.productID]
	}
	out.Tiers = nil
	if expandTiers {
		out.Tiers = p.tiers
	}
	return &out
}

// PriceSeed is one price the control API or the catalog file puts in the account.
type PriceSeed struct {
	ID            string            `json:"id"`
	Product       string            `json:"product"`
	ProductName   string            `json:"product_name"`
	Currency      string            `json:"currency"`
	UnitAmount    *int64            `json:"unit_amount"`
	Interval      string            `json:"interval"`
	IntervalCount int               `json:"interval_count"`
	UsageType     string            `json:"usage_type"`
	Meter         string            `json:"meter"`
	TiersMode     string            `json:"tiers_mode"`
	Tiers         []Tier            `json:"tiers"`
	LookupKey     string            `json:"lookup_key"`
	Nickname      string            `json:"nickname"`
	Metadata      map[string]string `json:"metadata"`
}

func (st *state) seedPrice(in PriceSeed, now int64) (*Price, error) {
	if in.Currency == "" {
		return nil, fmt.Errorf("price %q needs a currency", in.ID)
	}
	if in.ID == "" {
		in.ID = st.id("price")
	}
	if in.Product == "" {
		in.Product = st.id("prod")
	}
	if st.products[in.Product] == nil {
		name := in.ProductName
		if name == "" {
			name = in.Product
		}
		st.products[in.Product] = &Product{ID: in.Product, Object: "product", Active: true, Created: now, Metadata: map[string]string{}, Name: name}
	}
	p := &Price{
		ID: in.ID, Object: "price", Active: true, BillingScheme: "per_unit", Created: now, Currency: in.Currency,
		Metadata: orEmpty(in.Metadata), Type: "one_time", UnitAmount: in.UnitAmount, productID: in.Product,
		LookupKey: optional(in.LookupKey), Nickname: optional(in.Nickname),
	}
	if in.Interval != "" {
		count, usage := in.IntervalCount, in.UsageType
		if count == 0 {
			count = 1
		}
		if usage == "" {
			usage = "licensed"
		}
		p.Type = "recurring"
		p.Recurring = &Recurring{Interval: in.Interval, IntervalCount: count, UsageType: usage, Meter: optional(in.Meter)}
	}
	if len(in.Tiers) > 0 {
		mode := in.TiersMode
		if mode == "" {
			mode = "graduated"
		}
		p.BillingScheme, p.TiersMode, p.tiers, p.UnitAmount = "tiered", &mode, in.Tiers, nil
	}
	if old := st.price(in.ID); old != nil {
		*old = *p
		return old, nil
	}
	st.prices = append(st.prices, p)
	sort.SliceStable(st.prices, func(i, j int) bool { return st.prices[i].ID < st.prices[j].ID })
	return p, nil
}

// MeterSeed is one meter the control API or the catalog file puts in the account.
type MeterSeed struct {
	ID          string `json:"id"`
	EventName   string `json:"event_name"`
	DisplayName string `json:"display_name"`
}

func (st *state) seedMeter(in MeterSeed, now int64) (*Meter, error) {
	if in.EventName == "" {
		return nil, fmt.Errorf("meter %q needs an event_name", in.ID)
	}
	if in.ID == "" {
		in.ID = st.id("mtr")
	}
	m := &Meter{
		ID: in.ID, Object: "billing.meter", Created: now, DisplayName: in.DisplayName, EventName: in.EventName, Status: "active",
		CustomerMapping:    map[string]any{"event_payload_key": "stripe_customer_id", "type": "by_id"},
		DefaultAggregation: map[string]any{"formula": "sum"},
		ValueSettings:      map[string]any{"event_payload_key": "value"},
	}
	if old := st.meterByID(in.ID); old != nil {
		*old = *m
		return old, nil
	}
	st.meters = append(st.meters, m)
	return m, nil
}

// catalogFile is the billing contract's stripe-catalog.json, read for one mode.
type catalogFile struct {
	Mapping map[string]map[string]string `json:"mapping"`
	Meters  map[string]map[string]string `json:"meters"`
	Prices  map[string]struct {
		ID         string  `json:"id"`
		Product    *string `json:"product"`
		UnitAmount *int64  `json:"unitAmount"`
		Currency   string  `json:"currency"`
		Recurring  *struct {
			Interval      string `json:"interval"`
			IntervalCount int    `json:"intervalCount"`
		} `json:"recurring"`
		Nickname  *string           `json:"nickname"`
		LookupKey *string           `json:"lookupKey"`
		Metadata  map[string]string `json:"metadata"`
	} `json:"prices"`
}

// catalogMeterEvents names the event each catalog meter counts; the file holds ids only.
var catalogMeterEvents = map[string]string{
	"BILLABLE_EVENTS":  "langwatch_billable_events",
	"INSTANT_EVAL_USD": "langwatch_instant_eval_usd",
}

// catalogMetered are priced per unit yet metered; the file does not say so.
var catalogMetered = map[string]bool{"CONNECTED_HOSTED_USAGE_QUARTERLY": true}

// seedCatalog puts every mapped price and meter of mode in the account under its
// real id, so the product's price catalog resolves against paymentsim unchanged.
// A recurring price with no unit amount is metered on BILLABLE_EVENTS and bills
// nothing until the control API reseeds it with tiers.
func (st *state) seedCatalog(raw []byte, mode string, now time.Time) error {
	var file catalogFile
	if err := json.Unmarshal(raw, &file); err != nil {
		return fmt.Errorf("reading the catalog: %w", err)
	}
	for name, ids := range file.Meters {
		if id := ids[mode]; id != "" {
			if _, err := st.seedMeter(MeterSeed{ID: id, EventName: catalogMeterEvents[name], DisplayName: name}, now.Unix()); err != nil {
				return err
			}
		}
	}
	billable := file.Meters["BILLABLE_EVENTS"][mode]
	for name, ids := range file.Mapping {
		id := ids[mode]
		detail, ok := file.Prices[id]
		if id == "" || !ok {
			continue
		}
		seed := PriceSeed{ID: id, Currency: detail.Currency, UnitAmount: detail.UnitAmount, Metadata: detail.Metadata, ProductName: name}
		seed.LookupKey, seed.Nickname = deref(detail.LookupKey), deref(detail.Nickname)
		seed.Product = deref(detail.Product)
		if r := detail.Recurring; r != nil {
			seed.Interval, seed.IntervalCount = r.Interval, r.IntervalCount
			if detail.UnitAmount == nil || catalogMetered[name] {
				seed.UsageType, seed.Meter = "metered", billable
			}
		}
		if _, err := st.seedPrice(seed, now.Unix()); err != nil {
			return err
		}
	}
	return nil
}

func optional(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func orEmpty(m map[string]string) map[string]string {
	if m == nil {
		return map[string]string{}
	}
	return m
}

func ptr[T any](v T) *T { return &v }
