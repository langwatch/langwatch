package spendemitter

// The metadata echo is caller-controlled, so the emitter has to hold it to the
// same bar the control plane's ingest schema does. A value the schema rejects
// costs the WHOLE spend record, not just the echo, so anything that would be
// refused there has to be dropped here instead.

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/app/pipeline"
)

/** @scenario The spend record's metadata echo holds to the ingest contract */
func TestMetadataEchoMatchesTheIngestContract(t *testing.T) {
	// The schema is `z.string().max(4096)` refined by
	// `typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)`.
	// Each rejected case below fails a DIFFERENT clause of it.
	for _, tc := range []struct {
		name string
		raw  string
		kept bool
	}{
		{name: "an object is echoed", raw: `{"call_site":"summary"}`, kept: true},
		{name: "an empty object is echoed", raw: `{}`, kept: true},
		{name: "no echo stays no echo", raw: ``, kept: false},
		// json.Unmarshal into a map accepts this and leaves the map nil, so it
		// is the one invalid value the type of the probe does not catch.
		{name: "null is not an object", raw: `null`, kept: false},
		{name: "an array is not an object", raw: `[1,2]`, kept: false},
		{name: "a string is not an object", raw: `"x"`, kept: false},
		{name: "a number is not an object", raw: `3`, kept: false},
		{name: "malformed json is not an object", raw: `{`, kept: false},
		{
			name: "an oversized object is past the bound",
			raw:  `{"k":"` + strings.Repeat("a", maxMetadataEchoBytes) + `"}`,
			kept: false,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			echo := validMetadataEcho(tc.raw, "req_aaaaaaaabbbbbbbbccccccccdddddddd")
			if tc.kept {
				assert.Equal(t, tc.raw, echo)
				return
			}
			assert.Empty(t, echo)
		})
	}
}

/** @scenario The spend record's metadata echo holds to the ingest contract */
func TestAdmissionShipsWithoutARejectableEcho(t *testing.T) {
	s := openTestSpool(t, t.TempDir())
	defer s.Close()
	e := NewEmitter(s)

	e.AdmitSpend(pipeline.SpendAdmission{
		GatewayRequestID: "01K1D3H8ZQ4M9X2C7V5B1N6P8T",
		OccurredAt:       time.Date(2026, 8, 17, 4, 0, 0, 0, time.UTC),
		OrganizationID:   "org_x",
		ProjectID:        "proj_x",
		MetadataJSON:     `null`,
	})

	// The record itself is what must survive: dropping the echo is the point,
	// dropping the admission would lose the charge.
	records := drainRecords(t, s, 1)
	require.Equal(t, "admitSpend", records[0].Command)
	var payload map[string]any
	require.NoError(t, json.Unmarshal(records[0].Payload, &payload))
	assert.Equal(t, "01K1D3H8ZQ4M9X2C7V5B1N6P8T", payload["gateway_request_id"])
	// `omitempty` drops the field rather than sending "", and the ingest
	// schema defaults it — so an absent key is the dropped echo on the wire.
	assert.NotContains(t, payload, "metadata")
}
