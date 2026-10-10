package voicesession

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"sort"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// The cost of the extra hop: an echo vendor on loopback, reached directly
// and through the relay. One echo crosses the relay twice, so the per-frame
// overhead is half the difference between the two round trips.

func echoVendor(b *testing.B) *httptest.Server {
	b.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer func() { _ = conn.CloseNow() }()
		for {
			kind, data, err := conn.Read(context.Background())
			if err != nil {
				return
			}
			if err := conn.Write(context.Background(), kind, data); err != nil {
				return
			}
		}
	}))
	b.Cleanup(server.Close)
	return server
}

func relayGateway(b *testing.B, vendor *httptest.Server) *httptest.Server {
	b.Helper()
	manager := NewManager(Options{
		Registry:      newFakeRegistry(),
		Vendor:        NewOpenAIVendor(vendor.Client(), nil),
		RelayEndpoint: func(domain.Credential, string) string { return vendor.URL },
		DrainBudget:   time.Hour,
	})
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		slot, err := manager.Admit(r.Context(), domain.RealtimeKindRealtime)
		if err != nil {
			return
		}
		_ = manager.Relay(w, r, RelayCall{Ticket: &domain.VoiceRelayTicket{
			Session: domain.BrokeredVoiceSession{
				SessionID: "bench", Kind: domain.RealtimeKindRealtime,
				Bundle: &domain.Bundle{VirtualKeyID: "vk_1", ProjectID: "proj_1"},
			},
			Slot:    slot,
			Release: func(context.Context, string) { slot.Release() },
		}})
	}))
	b.Cleanup(gateway.Close)
	return gateway
}

func benchmarkEcho(b *testing.B, target string, kind websocket.MessageType, frame []byte) {
	b.Helper()
	ctx := context.Background()
	conn, _, err := websocket.Dial(ctx, target, nil)
	if err != nil {
		b.Fatal(err)
	}
	defer func() { _ = conn.CloseNow() }()
	conn.SetReadLimit(relayReadLimit)
	for i := 0; i < 200; i++ {
		_ = conn.Write(ctx, kind, frame)
		_, _, _ = conn.Read(ctx)
	}

	trips := make([]time.Duration, 0, b.N)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		start := time.Now()
		if err := conn.Write(ctx, kind, frame); err != nil {
			b.Fatal(err)
		}
		_, echoed, err := conn.Read(ctx)
		if err != nil {
			b.Fatal(err)
		}
		trips = append(trips, time.Since(start))
		if len(echoed) != len(frame) {
			b.Fatalf("echo of %d bytes came back as %d", len(frame), len(echoed))
		}
	}
	b.StopTimer()
	sort.Slice(trips, func(i, j int) bool { return trips[i] < trips[j] })
	percentile := func(p float64) float64 {
		return float64(trips[int(float64(len(trips)-1)*p)].Nanoseconds()) / 1000
	}
	b.ReportMetric(percentile(0.50), "p50-us/trip")
	b.ReportMetric(percentile(0.95), "p95-us/trip")
}

func BenchmarkRelayFrame(b *testing.B) {
	text := []byte(`{"type":"response.output_audio_transcript.delta","event_id":"event_1","response_id":"resp_1",` +
		`"item_id":"item_1","output_index":0,"content_index":0,"delta":"Hello there, how can I help you today?"}`)
	binary := bytes.Repeat([]byte{0x5a}, 4096)
	frames := []struct {
		name string
		kind websocket.MessageType
		data []byte
	}{
		{"text", websocket.MessageText, text},
		{"binary4KiB", websocket.MessageBinary, binary},
	}
	vendor := echoVendor(b)
	gateway := relayGateway(b, vendor)
	for _, frame := range frames {
		b.Run(frame.name+"/direct", func(b *testing.B) { benchmarkEcho(b, vendor.URL, frame.kind, frame.data) })
		b.Run(frame.name+"/relay", func(b *testing.B) { benchmarkEcho(b, gateway.URL, frame.kind, frame.data) })
	}
}
