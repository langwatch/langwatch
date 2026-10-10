package apidiff

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"
)

// requestLog is what one fake side was asked, in arrival order.
type requestLog struct {
	mu       sync.Mutex
	requests []string
}

func (log *requestLog) add(request string) {
	log.mu.Lock()
	defer log.mu.Unlock()
	log.requests = append(log.requests, request)
}

func (log *requestLog) snapshot() []string {
	log.mu.Lock()
	defer log.mu.Unlock()
	return slices.Clone(log.requests)
}

// fakeSide answers alpha and beta: a create, lists holding one item each, an
// item read and deletes. meet, when set, holds the request it names until
// the other has arrived, or two seconds pass.
func fakeSide(t *testing.T, log *requestLog, meet *rendezvous) string {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		key := request.Method + " " + request.URL.Path
		log.add(key)
		meet.wait(key)
		writer.Header().Set("Content-Type", "application/json")
		switch key {
		case "POST /api/alpha", "GET /api/alpha/a1", "GET /api/aardvark/a1":
			_ = json.NewEncoder(writer).Encode(map[string]any{"id": "a1"})
		case "GET /api/alpha":
			_ = json.NewEncoder(writer).Encode(map[string]any{"items": []any{map[string]any{"id": "a1"}}})
		case "GET /api/beta":
			_ = json.NewEncoder(writer).Encode(map[string]any{"items": []any{map[string]any{"id": "b1"}}})
		case "DELETE /api/alpha/a1", "DELETE /api/beta/b1":
			writer.WriteHeader(http.StatusNoContent)
		default:
			writer.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(server.Close)
	return server.URL
}

// rendezvous holds each of two requests until both have arrived.
type rendezvous struct {
	arrived map[string]chan struct{}
	missed  sync.Map
}

func newRendezvous(first, second string) *rendezvous {
	return &rendezvous{arrived: map[string]chan struct{}{first: make(chan struct{}), second: make(chan struct{})}}
}

func (meet *rendezvous) wait(key string) {
	if meet == nil || meet.arrived[key] == nil {
		return
	}
	close(meet.arrived[key])
	for other, arrived := range meet.arrived {
		if other == key {
			continue
		}
		select {
		case <-arrived:
		case <-time.After(2 * time.Second):
			meet.missed.Store(key, other)
		}
	}
}

func wavesEngine(sideA, sideB string, concurrency int) *probeEngine {
	return &probeEngine{
		ctx: context.Background(), client: &http.Client{Timeout: 5 * time.Second},
		options: ProbeOptions{
			A: sideA, B: sideB, SettleTimeout: 50 * time.Millisecond, Concurrency: concurrency,
			ModuleOf: func(_, path string) string { return strings.Split(path, "/")[2] },
		},
		symbolsA: NewSymbolTable(), symbolsB: NewSymbolTable(),
		ownerIDs: map[string]*sideIDs{}, statusDiffs: map[string]bool{},
		credsA: sideCredentials{}, credsB: sideCredentials{},
	}
}

func idParam() []Param {
	return []Param{{Name: "id", In: "path", Required: true}}
}

func transcriptKeys(transcripts []Transcript) []string {
	keys := make([]string, 0, len(transcripts))
	for _, transcript := range transcripts {
		keys = append(keys, transcript.Method+" "+transcript.RequestPathA)
	}
	return keys
}

func TestModulesProbeBesideEachOtherEachInItsOwnOrder(t *testing.T) {
	meet := newRendezvous("POST /api/alpha", "GET /api/beta")
	logA := &requestLog{}
	engine := wavesEngine(fakeSide(t, logA, meet), fakeSide(t, &requestLog{}, nil), 2)
	selected := []Operation{
		{Method: http.MethodGet, Path: "/api/alpha", InA: true, InB: true},
		{Method: http.MethodPost, Path: "/api/alpha", InA: true, InB: true},
		{Method: http.MethodGet, Path: "/api/alpha/{id}", Params: idParam(), InA: true, InB: true},
		{Method: http.MethodGet, Path: "/api/beta", InA: true, InB: true},
	}

	_, probed, _ := engine.mainPass(selected)

	meet.missed.Range(func(key, other any) bool {
		t.Errorf("%s never saw %s arrive beside it: the modules ran one after the other", key, other)
		return true
	})
	if probed != 4 {
		t.Fatalf("probed %d, want 4", probed)
	}
	var alpha []string
	for _, request := range logA.snapshot() {
		if strings.Contains(request, "/api/alpha") {
			alpha = append(alpha, request)
		}
	}
	if want := []string{"GET /api/alpha", "POST /api/alpha", "GET /api/alpha/a1"}; !slices.Equal(alpha, want) {
		t.Fatalf("alpha's own order: got %v, want %v (its read resolves the id its create captured)", alpha, want)
	}
	got, want := transcriptKeys(engine.transcripts), []string{"GET /api/alpha", "POST /api/alpha", "GET /api/alpha/a1", "GET /api/beta"}
	if !slices.Equal(got, want) {
		t.Fatalf("transcripts are filed in probe order: got %v, want %v", got, want)
	}
}

func TestDeletesWaitForTheListCheckInEveryModule(t *testing.T) {
	logA := &requestLog{}
	engine := wavesEngine(fakeSide(t, logA, nil), fakeSide(t, &requestLog{}, nil), 2)
	selected := probeOrder([]Operation{
		{Method: http.MethodGet, Path: "/api/alpha", InA: true, InB: true},
		{Method: http.MethodPost, Path: "/api/alpha", InA: true, InB: true},
		{Method: http.MethodDelete, Path: "/api/alpha/{id}", Params: idParam(), InA: true, InB: true},
		{Method: http.MethodGet, Path: "/api/beta", InA: true, InB: true},
		{Method: http.MethodDelete, Path: "/api/beta/{id}", Params: idParam(), InA: true, InB: true},
	})

	_, _, verified := engine.mainPass(selected)

	requests := logA.snapshot()
	firstDelete := slices.IndexFunc(requests, func(request string) bool { return strings.HasPrefix(request, http.MethodDelete) })
	if !verified || firstDelete < 0 {
		t.Fatalf("verified %v, requests %v: want the lists verified and both deletes sent", verified, requests)
	}
	listReads := 0
	for index, request := range requests {
		deleting := strings.HasPrefix(request, http.MethodDelete)
		if !deleting && index > firstDelete {
			t.Fatalf("%s arrived after the first delete: %v", request, requests)
		}
		if request == "GET /api/alpha" {
			listReads++
		}
	}
	if listReads != 2 {
		t.Fatalf("GET /api/alpha read %d times before any delete, want the main pass's and the list check's: %v", listReads, requests)
	}
	if deletes := len(requests) - firstDelete; deletes != 2 {
		t.Fatalf("%d deletes sent, want 2: %v", deletes, requests)
	}
}

func TestAnotherModulesProducerRunsBeforeItsConsumer(t *testing.T) {
	logA := &requestLog{}
	engine := wavesEngine(fakeSide(t, logA, nil), fakeSide(t, &requestLog{}, nil), 2)
	selected := []Operation{
		{Method: http.MethodGet, Path: "/api/aardvark/{alphaId}", Params: []Param{{Name: "alphaId", In: "path", Required: true}}, InA: true, InB: true},
		{Method: http.MethodPost, Path: "/api/alpha", InA: true, InB: true},
	}

	findings, _, _ := engine.mainPass(selected)

	if want := []string{"POST /api/alpha", "GET /api/aardvark/a1"}; !slices.Equal(logA.snapshot(), want) {
		t.Fatalf("got %v, want %v: aardvark reads the id alpha's create mints, so alpha's create goes first; findings %+v", logA.snapshot(), want, findings)
	}
}
