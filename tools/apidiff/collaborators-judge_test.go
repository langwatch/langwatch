package apidiff

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"testing"
)

func TestTheJudgeStubAnswersBooleanQuestionsOverTLSTheInstancesTrust(t *testing.T) {
	stub, err := startLangyAgentStub()
	if err != nil {
		t.Fatal(err)
	}
	defer stub.Close()
	judge := judgeBeside(stub.URL("branch"))
	if judge == nil {
		t.Fatal("no judge started beside the Langy stub")
	}
	bundle, err := os.ReadFile(judge.caPath)
	if err != nil {
		t.Fatal(err)
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(bundle) {
		t.Fatal("the CA bundle holds no certificate")
	}
	client := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS12}}}

	for _, key := range []string{throwawayJudgeKey, "wrong"} {
		body := `{"state":"text","model":"jev-latest","questions":{"named":{"type":"noul","instructions":"?"},"graded":{"type":"score"}}}`
		request, _ := http.NewRequestWithContext(context.Background(), http.MethodPost, judge.url+judgePath, strings.NewReader(body))
		request.Header.Set("Authorization", "Bearer "+key)
		response, err := client.Do(request)
		if err != nil {
			t.Fatalf("the judge is not reachable over TLS with the bundle: %v", err)
		}
		var answered struct {
			Answers map[string]struct {
				Noul float64 `json:"noul"`
			} `json:"answers"`
		}
		_ = json.NewDecoder(response.Body).Decode(&answered)
		response.Body.Close()
		if key != throwawayJudgeKey {
			if response.StatusCode != http.StatusUnauthorized {
				t.Errorf("a foreign key: %d, want 401", response.StatusCode)
			}
			continue
		}
		if response.StatusCode != http.StatusOK || answered.Answers["named"].Noul != 0.9 {
			t.Fatalf("boolean answer: %d %+v", response.StatusCode, answered)
		}
		if _, ok := answered.Answers["graded"]; ok {
			t.Error("a score question was answered with a boolean's shape")
		}
	}
}

func TestInstancesAreSentTheJudgeStartedBesideTheirLangyStub(t *testing.T) {
	stub, err := startLangyAgentStub()
	if err != nil {
		t.Fatal(err)
	}
	judge := judgeBeside(stub.URL("main"))
	joined := strings.Join(collaboratorEnv("main", stub.URL("main")), "\n")
	for _, want := range []string{"JEV_BASE_URL=" + judge.url, "NODE_EXTRA_CA_CERTS=" + judge.caPath} {
		if !strings.Contains(joined, want) {
			t.Errorf("instance env missing %q", want)
		}
	}
	stub.Close()
	if judgeBeside(stub.URL("main")) != nil {
		t.Error("a closed stub still names its judge")
	}
	if _, err := os.Stat(judge.caPath); !os.IsNotExist(err) {
		t.Error("the CA bundle outlived the stub")
	}
	if !strings.Contains(strings.Join(collaboratorEnv("main", "http://127.0.0.1:9/main"), "\n"), "JEV_BASE_URL="+throwawayJudgeBaseURL) {
		t.Error("without a stub the judge must stay the dead loopback port")
	}
}
