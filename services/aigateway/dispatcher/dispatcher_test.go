package dispatcher

import (
	"strings"
	"testing"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func TestValidate_RejectsMissingType(t *testing.T) {
	err := validate(Request{
		Model:      "gpt-5-mini",
		Body:       []byte(`{}`),
		Credential: domain.Credential{ProviderID: domain.ProviderOpenAI, APIKey: "sk-x"},
	})
	if err == nil || !strings.Contains(err.Error(), "Type") {
		t.Fatalf("expected Type error, got %v", err)
	}
}

func TestValidate_RejectsMissingProviderID(t *testing.T) {
	err := validate(Request{
		Type:       domain.RequestTypeChat,
		Model:      "gpt-5-mini",
		Body:       []byte(`{}`),
		Credential: domain.Credential{APIKey: "sk-x"},
	})
	if err == nil || !strings.Contains(err.Error(), "ProviderID") {
		t.Fatalf("expected ProviderID error, got %v", err)
	}
}

func TestValidate_RejectsEmptyBody(t *testing.T) {
	err := validate(Request{
		Type:       domain.RequestTypeChat,
		Model:      "gpt-5-mini",
		Credential: domain.Credential{ProviderID: domain.ProviderOpenAI, APIKey: "sk-x"},
	})
	if err == nil || !strings.Contains(err.Error(), "Body") {
		t.Fatalf("expected Body error, got %v", err)
	}
}

func TestValidate_AcceptsMinimalChat(t *testing.T) {
	err := validate(Request{
		Type:       domain.RequestTypeChat,
		Model:      "gpt-5-mini",
		Body:       []byte(`{"model":"gpt-5-mini","messages":[]}`),
		Credential: domain.Credential{ProviderID: domain.ProviderOpenAI, APIKey: "sk-x"},
	})
	if err != nil {
		t.Fatalf("expected nil, got %v", err)
	}
}

func TestDomainRequest_PreservesBody(t *testing.T) {
	body := []byte(`{"model":"x","messages":[]}`)
	req := Request{
		Type: domain.RequestTypeChat, Model: "x", Body: body,
		Credential: domain.Credential{ProviderID: domain.ProviderOpenAI},
	}
	dr := domainRequest(req, nil)
	if string(dr.Body) != string(body) {
		t.Fatalf("body not preserved")
	}
	if dr.Type != domain.RequestTypeChat {
		t.Fatalf("type not preserved")
	}
	if dr.Model != "x" {
		t.Fatalf("model not preserved")
	}
	if dr.BodyReader == nil {
		t.Fatalf("BodyReader should be populated for streaming consumers")
	}
}

func TestDomainRequest_PassthroughCarriesHTTP(t *testing.T) {
	req := Request{
		Type: domain.RequestTypePassthrough, Model: "gemini-2.5-flash",
		Body:       []byte(`{}`),
		Credential: domain.Credential{ProviderID: domain.ProviderGemini},
	}
	hp := &domain.PassthroughRequest{
		Method: "POST", Path: "/models/gemini-2.5-flash:generateContent",
		Stream: false,
	}
	dr := domainRequest(req, hp)
	if dr.Passthrough.Path != hp.Path {
		t.Fatalf("passthrough path lost")
	}
	if dr.Passthrough.Method != "POST" {
		t.Fatalf("passthrough method lost")
	}
}

func TestReaderOnce_ReadsThenEOF(t *testing.T) {
	r := &readerOnce{b: []byte("hello")}
	buf := make([]byte, 10)
	n, err := r.Read(buf)
	if n != 5 || err != nil {
		t.Fatalf("first read: n=%d err=%v", n, err)
	}
	if string(buf[:n]) != "hello" {
		t.Fatalf("body mismatch: %q", buf[:n])
	}
	n2, err2 := r.Read(buf)
	if n2 != 0 || err2 == nil {
		t.Fatalf("second read should EOF: n=%d err=%v", n2, err2)
	}
}
