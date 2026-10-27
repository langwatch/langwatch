package matrixseed

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const multiLineKey = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkq\n\"quoted\"<tag>&\n-----END PRIVATE KEY-----\n"

// echoServer answers every call 400 with the request's body and bearer token.
func echoServer(t *testing.T) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"echo":` + string(raw) + `,"auth":"` + r.Header.Get("Authorization") + `"}`))
	}))
	t.Cleanup(server.Close)
	return server
}

/** @scenario "A refused request never prints a submitted secret" */
func TestRefusedModelProviderPutNeverPrintsTheBody(t *testing.T) {
	c := &client{base: echoServer(t).URL, http: http.DefaultClient, token: "project-token-value"}
	keys := map[string]string{"GOOGLE_APPLICATION_CREDENTIALS": `{"private_key":` + `"` + strings.ReplaceAll(multiLineKey, "\n", `\n`) + `"}`, "OPENAI_API_KEY": "sk-secret-openai"}
	_, err := c.putModelProvider(context.Background(), "vertex_ai", keys)
	if err == nil {
		t.Fatal("want a refusal")
	}
	out := err.Error()
	for _, leak := range []string{"sk-secret-openai", "MIIEvQIBADANBgkq", "PRIVATE KEY", "project-token-value", "echo"} {
		if strings.Contains(out, leak) {
			t.Fatalf("the refusal printed %q: %s", leak, out)
		}
	}
	if !strings.Contains(out, "400") {
		t.Fatalf("the refusal lost its status: %s", out)
	}
}

func TestRefusedOtherCallRedactsSubmittedSecrets(t *testing.T) {
	c := &client{base: echoServer(t).URL, http: http.DefaultClient, token: "instance-admin-token"}
	name := "name-" + multiLineKey
	_, err := c.provisionOrganization(context.Background(), name)
	if err == nil {
		t.Fatal("want a refusal")
	}
	out := err.Error()
	for _, leak := range []string{"instance-admin-token", "MIIEvQIBADANBgkq", `MIIEvQIBADANBgkq\n`} {
		if strings.Contains(out, leak) {
			t.Fatalf("the refusal printed %q: %s", leak, out)
		}
	}
	if !strings.Contains(out, "[redacted]") {
		t.Fatalf("want the redaction marker in the snippet: %s", out)
	}
}

func TestSnippetRemovesJSONEscapedForms(t *testing.T) {
	got := snippet([]byte(`{"k":"-----BEGIN\nMIIE\"x\""}`), []string{"-----BEGIN\nMIIE\"x\""})
	if strings.Contains(got, "MIIE") {
		t.Fatalf("snippet kept the escaped secret: %s", got)
	}
}

/** @scenario "The Azure api version is stored when the job sets it" */
func TestAzureKeepsAnAPIVersionWhenSet(t *testing.T) {
	env := map[string]string{
		"AZURE_OPENAI_API_KEY": "k", "AZURE_OPENAI_ENDPOINT": "https://x", "AZURE_OPENAI_API_VERSION": "2025-01-01-preview",
	}
	keys, missing := azureKeys(envOf(env))
	if len(missing) != 0 || keys["AZURE_OPENAI_API_VERSION"] != "2025-01-01-preview" {
		t.Fatalf("keys=%v missing=%v", keys, missing)
	}
	delete(env, "AZURE_OPENAI_API_VERSION")
	keys, _ = azureKeys(envOf(env))
	if _, ok := keys["AZURE_OPENAI_API_VERSION"]; ok {
		t.Fatalf("an empty version must not be stored: %v", keys)
	}
}
