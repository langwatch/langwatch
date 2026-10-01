package analyticssim

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"strings"
)

// decodeBody undoes the encodings the PostHog clients use: gzip (posthog-node's
// Content-Encoding, posthog-js's ?compression=gzip-js) and posthog-js's
// form-encoded base64 `data=` field. Anything else is taken as JSON.
func decodeBody(body []byte, contentEncoding, compression, contentType string) ([]byte, error) {
	if contentEncoding == "gzip" || compression == "gzip-js" {
		reader, err := gzip.NewReader(bytes.NewReader(body))
		if err != nil {
			return nil, fmt.Errorf("the body is not gzip: %w", err)
		}
		if body, err = io.ReadAll(reader); err != nil {
			return nil, fmt.Errorf("the body is not gzip: %w", err)
		}
	}
	if strings.HasPrefix(contentType, "application/x-www-form-urlencoded") {
		form, err := url.ParseQuery(string(body))
		if err != nil {
			return nil, fmt.Errorf("the form body does not parse: %w", err)
		}
		data := form.Get("data")
		if decoded, err := base64.StdEncoding.DecodeString(data); err == nil {
			return decoded, nil
		}
		return []byte(data), nil
	}
	return body, nil
}

// postHogMessage is one captured message as either client sends it: posthog-node
// puts distinct_id at the top, posthog-js inside properties.
type postHogMessage struct {
	Event      string         `json:"event"`
	DistinctID string         `json:"distinct_id"`
	Properties map[string]any `json:"properties"`
	Set        map[string]any `json:"$set"`
}

// NormalizePostHog reads a capture body: {"batch": [...]}, a bare array, or one
// message. $identify and $set are identifies, $create_alias an alias,
// $groupidentify a group; everything else is an event.
func NormalizePostHog(body []byte) ([]Record, error) {
	var raws []json.RawMessage
	trimmed := bytes.TrimSpace(body)
	switch {
	case bytes.HasPrefix(trimmed, []byte("[")):
		if err := json.Unmarshal(trimmed, &raws); err != nil {
			return nil, fmt.Errorf("the body is not a PostHog batch: %w", err)
		}
	default:
		var envelope struct {
			Batch []json.RawMessage `json:"batch"`
		}
		if err := json.Unmarshal(trimmed, &envelope); err != nil {
			return nil, fmt.Errorf("the body is not a PostHog capture: %w", err)
		}
		raws = envelope.Batch
		if raws == nil {
			raws = []json.RawMessage{trimmed}
		}
	}
	records := make([]Record, 0, len(raws))
	for _, raw := range raws {
		var m postHogMessage
		if err := json.Unmarshal(raw, &m); err != nil {
			return nil, fmt.Errorf("a PostHog message does not parse: %w", err)
		}
		records = append(records, postHogRecord(m, raw))
	}
	return records, nil
}

func postHogRecord(m postHogMessage, raw json.RawMessage) Record {
	props := m.Properties
	if props == nil {
		props = map[string]any{}
	}
	id := m.DistinctID
	if id == "" {
		id, _ = props["distinct_id"].(string)
	}
	r := Record{Provider: ProviderPostHog, DistinctID: id, Raw: raw}
	switch m.Event {
	case "$identify", "$set":
		r.Kind = KindIdentify
		r.Properties = map[string]any{}
		for _, set := range []any{props["$set"], m.Set} {
			if traits, ok := set.(map[string]any); ok {
				for k, v := range traits {
					r.Properties[k] = v
				}
			}
		}
	case "$create_alias":
		r.Kind, r.Properties = KindAlias, map[string]any{"alias": props["alias"]}
	case "$groupidentify":
		r.Kind = KindGroup
		r.Name, _ = props["$group_type"].(string)
		r.Properties, _ = props["$group_set"].(map[string]any)
		if key, ok := props["$group_key"]; ok {
			if r.Properties == nil {
				r.Properties = map[string]any{}
			}
			r.Properties["$group_key"] = key
		}
	default:
		r.Kind, r.Name, r.Properties = KindEvent, m.Event, props
	}
	return r
}

// cdpCall is one Customer.io CDP (Segment-shaped) call: identify, track, group,
// alias, page or screen.
type cdpCall struct {
	Type        string         `json:"type"`
	UserID      string         `json:"userId"`
	AnonymousID string         `json:"anonymousId"`
	Event       string         `json:"event"`
	Name        string         `json:"name"`
	GroupID     string         `json:"groupId"`
	PreviousID  string         `json:"previousId"`
	Traits      map[string]any `json:"traits"`
	Properties  map[string]any `json:"properties"`
}

// NormalizeCustomerIOCDP reads a body posted to the CDP API's /v1/<callType>;
// callType "batch" reads {"batch": [...]}, each call naming its own type.
func NormalizeCustomerIOCDP(callType string, body []byte) ([]Record, error) {
	raws := []json.RawMessage{body}
	if callType == "batch" {
		var envelope struct {
			Batch []json.RawMessage `json:"batch"`
		}
		if err := json.Unmarshal(body, &envelope); err != nil {
			return nil, fmt.Errorf("the body is not a Customer.io batch: %w", err)
		}
		raws = envelope.Batch
	}
	records := make([]Record, 0, len(raws))
	for _, raw := range raws {
		var call cdpCall
		if err := json.Unmarshal(raw, &call); err != nil {
			return nil, fmt.Errorf("a Customer.io call does not parse: %w", err)
		}
		if callType != "batch" {
			call.Type = callType
		}
		records = append(records, cdpRecord(call, raw))
	}
	return records, nil
}

func cdpRecord(call cdpCall, raw json.RawMessage) Record {
	id := call.UserID
	if id == "" {
		id = call.AnonymousID
	}
	r := Record{Provider: ProviderCustomerIO, DistinctID: id, Raw: raw}
	switch call.Type {
	case "identify":
		r.Kind, r.Properties = KindIdentify, call.Traits
	case "group":
		r.Kind, r.Name, r.Properties = KindGroup, call.GroupID, call.Traits
	case "alias":
		r.Kind, r.Properties = KindAlias, map[string]any{"previousId": call.PreviousID}
	case "page", "screen":
		r.Kind, r.Name, r.Properties = KindEvent, call.Type+":"+call.Name, call.Properties
	default:
		r.Kind, r.Name, r.Properties = KindEvent, call.Event, call.Properties
	}
	return r
}

// NormalizeCustomerIOTrack reads the Track API: PUT /api/v1/customers/{id}
// (its body is the traits) and POST /api/v1/customers/{id}/events ({name, data}).
func NormalizeCustomerIOTrack(customerID string, isEvent bool, body []byte) (Record, error) {
	r := Record{Provider: ProviderCustomerIO, DistinctID: customerID, Raw: body}
	if !isEvent {
		r.Kind = KindIdentify
		if err := json.Unmarshal(body, &r.Properties); err != nil {
			return Record{}, fmt.Errorf("the body is not Customer.io attributes: %w", err)
		}
		return r, nil
	}
	var event struct {
		Name string         `json:"name"`
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal(body, &event); err != nil {
		return Record{}, fmt.Errorf("the body is not a Customer.io event: %w", err)
	}
	r.Kind, r.Name, r.Properties = KindEvent, event.Name, event.Data
	return r, nil
}
