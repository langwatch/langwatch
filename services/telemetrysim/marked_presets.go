package telemetrysim

import "strings"

// markedPresets are traces a tester can find by name ("seed: ..."): one per shape that rows ask for
// and a plain seed does not guarantee. Texts are invented.
var markedPresets = []Preset{
	{Name: "seed-evals", Signal: SignalTraces, Service: "northwind-agents", Spans: []SpanShape{
		{Name: "seed: evals", Kind: internal, DurationMs: 2200, Attrs: []Attr{
			{"langwatch.span.type", "agent"}, {"langwatch.thread.id", "$session"}, {"langwatch.user.id", "$user"},
			{"langwatch.input", "seed: evals - summarise ticket 9012."},
			{"langwatch.output", "Checkout fails for EU cards since 09:12."},
		}, Events: []EventShape{
			{Name: "langwatch.evaluation.custom", OffsetMs: 2000, Attrs: []Attr{{"json_encoded_event", `{"name":"seed-faithfulness","type":"custom","status":"processed","passed":true,"score":0.92,"details":"grounded in the ticket"}`}}},
			{Name: "langwatch.evaluation.custom", OffsetMs: 2100, Attrs: []Attr{{"json_encoded_event", `{"name":"seed-toxicity","type":"custom","status":"processed","passed":false,"score":0.71,"label":"flagged","details":"seeded failing result"}`}}},
		}},
	}},
	// The data URI is lifted out of the span into stored objects (storagesim) at ingestion.
	{Name: "seed-offload", Signal: SignalTraces, Service: "northwind-vision", Spans: []SpanShape{
		{Name: "seed: offload", Kind: internal, DurationMs: 1800, Attrs: []Attr{
			{"langwatch.span.type", "agent"}, {"langwatch.thread.id", "$session"}, {"langwatch.user.id", "$user"},
		}},
		{Name: "chat gpt-4o", Parent: 1, Kind: client, OffsetMs: 20, DurationMs: 1600, Attrs: []Attr{
			{"gen_ai.operation.name", "chat"}, {"gen_ai.system", "openai"}, {"gen_ai.request.model", "gpt-4o"},
			{"langwatch.input", `[{"role":"user","content":[{"type":"text","text":"seed: offload - what is in this picture?"},{"type":"image_url","image_url":{"url":"data:image/png;base64,` + seedPNG + `"}}]}]`},
			{"langwatch.output", "A single red pixel."},
		}},
	}},
	// Every batch is one more turn of the same thread: send it with --batches 4.
	{Name: "seed-conversation", Signal: SignalTraces, Service: "northwind-assistant", Spans: []SpanShape{
		{Name: "seed: conversation turn", Kind: internal, DurationMs: 1700, Attrs: []Attr{
			{"langwatch.span.type", "agent"}, {"gen_ai.conversation.id", "seed-conversation-thread"},
			{"langwatch.thread.id", "seed-conversation-thread"}, {"langwatch.user.id", "$user"},
			{"langwatch.input", "seed: conversation - and has my last order shipped?"},
			{"langwatch.output", "Yes, it left the warehouse this morning."},
		}},
		{Name: "chat gpt-4o-mini", Parent: 1, Kind: client, OffsetMs: 30, DurationMs: 1400, Attrs: []Attr{
			{"gen_ai.operation.name", "chat"}, {"gen_ai.system", "openai"}, {"gen_ai.request.model", "gpt-4o-mini"},
			{"gen_ai.usage.input_tokens", 500}, {"gen_ai.usage.output_tokens", 40},
		}},
	}},
	{Name: "seed-multimodal", Signal: SignalTraces, Service: "northwind-vision", Spans: []SpanShape{
		{Name: "seed: multimodal", Kind: internal, DurationMs: 2800, Attrs: []Attr{
			{"langwatch.span.type", "agent"}, {"langwatch.thread.id", "$session"}, {"langwatch.user.id", "$user"},
		}},
		{Name: "chat gpt-4o", Parent: 1, Kind: client, OffsetMs: 30, DurationMs: 2600, Attrs: []Attr{
			{"gen_ai.operation.name", "chat"}, {"gen_ai.system", "openai"}, {"gen_ai.request.model", "gpt-4o"},
			{"gen_ai.usage.input_tokens", 1100}, {"gen_ai.usage.output_tokens", 60},
			{"langwatch.input", `[{"role":"user","content":[{"type":"text","text":"seed: multimodal - what is the total?"},{"type":"image_url","image_url":{"url":"https://example.com/seed/receipt-17.png"}}]}]`},
			{"langwatch.output", "The receipt total is 42.80 EUR."},
		}},
	}},
}

// seedPNG is a 1x1 red PNG.
var seedPNG = strings.TrimSpace("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==")
