package providers

import (
	"bytes"

	"github.com/bytedance/sonic"
	"github.com/tidwall/sjson"
)

// providerInternalFields are the extra_fields keys that hold the provider's
// raw exchange. Its response headers name the provider account, so none of
// them belongs on a response the gateway's caller reads.
var providerInternalFields = []string{
	"extra_fields.raw_request",
	"extra_fields.raw_response",
	"extra_fields.provider_response_headers",
}

var providerInternalMarkers = [][]byte{
	[]byte(`"raw_request"`),
	[]byte(`"raw_response"`),
	[]byte(`"provider_response_headers"`),
}

// publicWireBody marshals a normalized response for the caller, without the
// provider internals. The rest of extra_fields (provider, latency, dropped
// parameters) is part of the envelope and stays.
func publicWireBody(resp any) []byte {
	body, _ := sonic.Marshal(resp)
	return withoutProviderInternals(body)
}

func withoutProviderInternals(body []byte) []byte {
	found := false
	for _, marker := range providerInternalMarkers {
		if bytes.Contains(body, marker) {
			found = true
			break
		}
	}
	if !found {
		return body
	}
	for _, field := range providerInternalFields {
		if stripped, err := sjson.DeleteBytes(body, field); err == nil {
			body = stripped
		}
	}
	return body
}
