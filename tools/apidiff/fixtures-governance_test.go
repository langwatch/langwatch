package apidiff

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// governanceRecord is what one fake side was sent.
type governanceRecord struct {
	budgets, spans int
}

// governanceSide answers tRPC in one transformer's form only, as each layout
// does. A side with restBudgets false refuses the REST budget create the way
// the branch does, leaving the dashboard's create.
func governanceSide(t *testing.T, superjson, restBudgets bool, sourceID string, record *governanceRecord) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(request.Body).Decode(&body)
		_, wrapped := body["json"]
		trpcAnswer := func(data map[string]any) {
			if wrapped != superjson || request.Header.Get("Cookie") == "" {
				writer.WriteHeader(http.StatusBadRequest)
				return
			}
			if superjson {
				data = map[string]any{"json": data}
			}
			_ = json.NewEncoder(writer).Encode(map[string]any{"result": map[string]any{"data": data}})
		}
		switch request.URL.Path {
		case ingestionSourcesProcedure:
			trpcAnswer(map[string]any{"source": map[string]any{"id": sourceID}, "ingestSecret": "lw_is_" + sourceID})
		case "/api/ingest/otel/" + sourceID:
			if request.Header.Get("Authorization") == "Bearer lw_is_"+sourceID {
				record.spans++
			}
			writer.WriteHeader(http.StatusAccepted)
		case "/api/auth/cli/governance/ingest/sources/" + sourceID + "/events":
			_ = json.NewEncoder(writer).Encode(map[string]any{"events": []any{map[string]any{"id": "event"}}})
		case budgetsPath:
			if !restBudgets {
				writer.WriteHeader(http.StatusInternalServerError)
				return
			}
			record.budgets++
			writer.WriteHeader(http.StatusCreated)
		case budgetsProcedure:
			record.budgets++
			trpcAnswer(map[string]any{"budget": map[string]any{"id": "budget"}})
		default:
			writer.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(server.Close)
	return server
}

func TestSeedGovernancePinsEachSidesOwnSourceAndCreatesABudget(t *testing.T) {
	var recordA, recordB governanceRecord
	sideA := governanceSide(t, false, false, "source-branch", &recordA)
	sideB := governanceSide(t, true, true, "source-main", &recordB)
	engine := &probeEngine{
		ctx: context.Background(), options: ProbeOptions{A: sideA.URL, B: sideB.URL}, client: &http.Client{Timeout: time.Second},
		symbolsA: NewSymbolTable(), symbolsB: NewSymbolTable(),
		credsA: sideCredentials{credSessionCookie: "session=a"}, credsB: sideCredentials{credSessionCookie: "session=b"},
	}
	engine.seedGovernance()
	for side, symbols := range map[string]*SymbolTable{"source-branch": engine.symbolsA, "source-main": engine.symbolsB} {
		if got, _ := symbols.Lookup("sourceId", "/api/auth/cli/governance/ingest/sources/{sourceId}/events"); got != side {
			t.Errorf("sourceId = %q, want %q", got, side)
		}
	}
	if recordA.budgets != 1 || recordB.budgets != 1 {
		t.Errorf("budgets created: A=%d B=%d, want one each", recordA.budgets, recordB.budgets)
	}
	if recordA.spans != 1 || recordB.spans != 1 {
		t.Errorf("spans sent to the source: A=%d B=%d, want one each, with its own secret", recordA.spans, recordB.spans)
	}
}

func TestErrorCodeReadsBothEnvelopes(t *testing.T) {
	branch := map[string]any{"code": "langy_conversation_not_found"}
	main := map[string]any{"error": map[string]any{"code": "langy_conversation_not_found"}}
	for name, body := range map[string]map[string]any{"branch": branch, "main": main} {
		if errorCode(body) != "langy_conversation_not_found" {
			t.Errorf("%s envelope: code %q", name, errorCode(body))
		}
	}
	if errorCode(map[string]any{"status": "ok"}) != "" {
		t.Error("a success body carries no code")
	}
}
