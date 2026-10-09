package telemetrysim

import (
	"strings"
	"testing"
	"time"
)

func markedJSON(t *testing.T, name string) string {
	t.Helper()
	p, ok := presetByName(name)
	if !ok {
		t.Fatalf("no preset %q", name)
	}
	out, err := Build(BatchSpec{Preset: p, Seed: 1, Start: time.Now(), Encoding: EncodingJSON})
	if err != nil {
		t.Fatal(err)
	}
	return string(out.Body)
}

func TestMarkedPresetsCarryTheirMark(t *testing.T) {
	for name, wants := range map[string][]string{
		"seed-evals":        {"seed: evals", "langwatch.evaluation.custom", "json_encoded_event", "seed-faithfulness"},
		"seed-offload":      {"seed: offload", "data:image/png;base64,iVBOR"},
		"seed-conversation": {"seed: conversation turn", "seed-conversation-thread"},
		"seed-multimodal":   {"seed: multimodal", "image_url"},
	} {
		body := markedJSON(t, name)
		for _, w := range wants {
			if !strings.Contains(body, w) {
				t.Errorf("%s: body lacks %q", name, w)
			}
		}
	}
}

func TestErrorSpanKeepsItsExtraEvents(t *testing.T) {
	p := Preset{Name: "x", Signal: SignalTraces, Spans: []SpanShape{{Name: "s", Error: "boom", Events: []EventShape{{Name: "extra"}}}}}
	out, err := Build(BatchSpec{Preset: p, Seed: 1, Start: time.Now(), Encoding: EncodingJSON})
	if err != nil {
		t.Fatal(err)
	}
	if b := string(out.Body); !strings.Contains(b, `"extra"`) || !strings.Contains(b, `"exception"`) {
		t.Errorf("events lost: %.300s", b)
	}
}
