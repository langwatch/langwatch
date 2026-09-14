package apidiff

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestGateCode(t *testing.T) {
	cases := []struct {
		name string
		body string
		want string
	}{
		{"envelope carries the code", `{"error":{"code":"enterprise_plan_required","meta":{"feature":"MANAGEMENT_API"}}}`, "enterprise_plan_required"},
		{"a different code", `{"error":{"code":"validation_error"}}`, "validation_error"},
		{"no error object", `{"ok":true}`, ""},
		{"error is not an object", `{"error":"boom"}`, ""},
		{"not JSON at all", `not json`, ""},
		{"empty body", "", ""},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := gateCode(testCase.body); got != testCase.want {
				t.Errorf("gateCode(%q) = %q, want %q", testCase.body, got, testCase.want)
			}
		})
	}
}

func TestGatedByChecksEitherSide(t *testing.T) {
	gatedBody := `{"error":{"code":"enterprise_plan_required"}}`
	okBody := `{"ok":true}`

	t.Run("given only the candidate is gated", func(t *testing.T) {
		transcript := Transcript{A: SideResult{Body: gatedBody}, B: SideResult{Body: okBody}}
		if !gatedBy(transcript) {
			t.Fatal("either side gated must trigger")
		}
	})
	t.Run("given only the base is gated", func(t *testing.T) {
		transcript := Transcript{A: SideResult{Body: okBody}, B: SideResult{Body: gatedBody}}
		if !gatedBy(transcript) {
			t.Fatal("either side gated must trigger")
		}
	})
	t.Run("given neither side is gated", func(t *testing.T) {
		transcript := Transcript{A: SideResult{Body: okBody}, B: SideResult{Body: okBody}}
		if gatedBy(transcript) {
			t.Fatal("neither side gated must not trigger")
		}
	})
}

// @scenario "The entitled pass skips an operation nothing gated"
func TestEntitledPassSkipsWhenNothingWasGated(t *testing.T) {
	t.Run("given a run where no operation hit the Enterprise gate", func(t *testing.T) {
		activated := false
		engine := &probeEngine{
			ctx: context.Background(),
			options: ProbeOptions{
				ActivateEntitlement: func(context.Context) error {
					activated = true
					return nil
				},
			},
		}

		t.Run("when the entitled pass runs", func(t *testing.T) {
			findings := engine.entitledPass()

			t.Run("then it activates nothing and reports nothing", func(t *testing.T) {
				if findings != nil {
					t.Fatalf("entitledPass = %+v, want nil", findings)
				}
				if activated {
					t.Fatal("an operation nothing gated must never activate entitlement")
				}
			})
		})
	})
}

// @scenario "The entitled pass skips honestly when no database is available to activate"
func TestEntitledPassSkipsWithoutAnActivator(t *testing.T) {
	t.Run("given an operation the main pass saw the Enterprise gate refuse", func(t *testing.T) {
		var progress bytes.Buffer
		engine := &probeEngine{
			ctx:     context.Background(),
			options: ProbeOptions{Progress: &progress},
			gatedOps: map[string]Operation{
				"GET /api/organization": {Method: "GET", Path: "/api/organization", InA: true, InB: true},
			},
		}

		t.Run("when the entitled pass runs with no ActivateEntitlement (probe mode, or the haven path)", func(t *testing.T) {
			findings := engine.entitledPass()

			t.Run("then it reports nothing rather than crashing, and says why on the progress stream", func(t *testing.T) {
				if findings != nil {
					t.Fatalf("entitledPass = %+v, want nil", findings)
				}
				if !strings.Contains(progress.String(), "entitled pass: skipped") {
					t.Fatalf("progress missing the skip note: %q", progress.String())
				}
			})
		})
	})
}

const entitledProbeSpec = `{
  "openapi": "3.0.3",
  "paths": {
    "/api/organization": {
      "get": {"operationId": "getOrganization", "responses": {"200": {"description": "ok"}}}
    }
  }
}`

// @scenario "The entitled pass re-probes a gated operation and keeps the unentitled refusal as its own finding"
func TestEntitledPassReprobesGatedOperations(t *testing.T) {
	t.Run("given the candidate gates one operation the base never gated", func(t *testing.T) {
		entitled := false
		candidate := newTestServer(t, entitledProbeSpec, map[string]http.HandlerFunc{
			"GET /api/organization": func(writer http.ResponseWriter, _ *http.Request) {
				if entitled {
					writeJSON(writer, 200, `{"plan":"enterprise"}`)
					return
				}
				writeJSON(writer, 402, `{"error":{"code":"enterprise_plan_required","meta":{"feature":"MANAGEMENT_API"}}}`)
			},
		})
		base := newTestServer(t, entitledProbeSpec, map[string]http.HandlerFunc{
			"GET /api/organization": func(writer http.ResponseWriter, _ *http.Request) {
				writeJSON(writer, 200, `{"plan":"enterprise"}`)
			},
		})
		operations := mustUnion(t, candidate, base)

		t.Run("when the activation attempt genuinely fixes the candidate", func(t *testing.T) {
			activated := false
			result := ProbeAll(context.Background(), ProbeOptions{
				A: candidate.URL, B: base.URL,
				Keys:    Keys{ProjectKey: DefaultProjectKey},
				Schemes: SecuritySchemes(mustFetchSpec(t, candidate), mustFetchSpec(t, base)),
				Client:  candidate.Client(),
				ActivateEntitlement: func(context.Context) error {
					activated = true
					entitled = true
					return nil
				},
			}, operations)

			t.Run("then it activated exactly once", func(t *testing.T) {
				if !activated {
					t.Fatal("a gated operation must activate entitlement")
				}
			})

			t.Run("then the unentitled refusal is still its own finding under the ordinary case", func(t *testing.T) {
				if !hasFinding(result.Findings, func(f Finding) bool { return f.Kind == FindingStatusDiff && f.Case == "read" }) {
					t.Fatalf("no unentitled status_diff finding among %+v", result.Findings)
				}
			})

			t.Run("then the entitled re-probe shows both sides now agree, under its own case and namespace", func(t *testing.T) {
				transcript, ok := findTranscript(result.Transcripts, entitledCaseName)
				if !ok {
					t.Fatal("no entitled-case transcript recorded")
				}
				if transcript.A.Status != 200 || transcript.B.Status != 200 {
					t.Fatalf("entitled transcript = %+v, want both sides 200", transcript)
				}
				if hasFinding(result.Findings, func(f Finding) bool { return f.Case == entitledCaseName }) {
					t.Fatal("both sides agreeing entitled must report no finding")
				}
			})
		})
	})
}

// @scenario "The entitled pass reports honestly when activation does not fix the gated side"
func TestEntitledPassReportsAnHonestAsymmetryWhenActivationDoesNotFixTheGatedSide(t *testing.T) {
	t.Run("given the candidate keeps refusing even after the license is activated (no license source composed)", func(t *testing.T) {
		candidate := newTestServer(t, entitledProbeSpec, map[string]http.HandlerFunc{
			"GET /api/organization": func(writer http.ResponseWriter, _ *http.Request) {
				writeJSON(writer, 402, `{"error":{"code":"enterprise_plan_required","meta":{"feature":"MANAGEMENT_API"}}}`)
			},
		})
		base := newTestServer(t, entitledProbeSpec, map[string]http.HandlerFunc{
			"GET /api/organization": func(writer http.ResponseWriter, _ *http.Request) {
				writeJSON(writer, 200, `{"plan":"unlimited"}`)
			},
		})
		operations := mustUnion(t, candidate, base)

		t.Run("when the entitled pass runs", func(t *testing.T) {
			result := ProbeAll(context.Background(), ProbeOptions{
				A: candidate.URL, B: base.URL,
				Keys:                Keys{ProjectKey: DefaultProjectKey},
				Schemes:             SecuritySchemes(mustFetchSpec(t, candidate), mustFetchSpec(t, base)),
				Client:              candidate.Client(),
				ActivateEntitlement: func(context.Context) error { return nil },
			}, operations)

			t.Run("then the entitled re-probe still shows the refusal, as a finding of its own", func(t *testing.T) {
				finding, ok := firstFinding(result.Findings, func(f Finding) bool { return f.Case == entitledCaseName })
				if !ok {
					t.Fatalf("no entitled-case finding among %+v", result.Findings)
				}
				if finding.Kind != FindingStatusDiff {
					t.Fatalf("entitled finding kind = %s, want %s", finding.Kind, FindingStatusDiff)
				}
			})

			t.Run("then its root cause is namespaced apart from the ordinary gate-disagreement cause", func(t *testing.T) {
				finding, _ := firstFinding(result.Findings, func(f Finding) bool { return f.Case == entitledCaseName })
				cause := RootCause(finding)
				if !strings.HasPrefix(cause, "entitled:") {
					t.Fatalf("rootCause = %q, want the entitled: namespace", cause)
				}
				twin := finding
				twin.Case = "read"
				if RootCause(twin) == cause {
					t.Fatalf("the entitled and ordinary namespaces must never collapse to one cause (%q)", cause)
				}
			})
		})
	})
}

func TestRootCauseNamespacesEntitledFindingsSeparately(t *testing.T) {
	fields := map[string][2]any{"status": {402, 200}}
	ordinary := Finding{Kind: FindingStatusDiff, Case: "read", Fields: fields}
	entitled := Finding{Kind: FindingStatusDiff, Case: entitledCaseName, Fields: fields}

	ordinaryCause := RootCause(ordinary)
	entitledCause := RootCause(entitled)
	if entitledCause != "entitled:"+ordinaryCause {
		t.Fatalf("RootCause(entitled) = %q, want %q", entitledCause, "entitled:"+ordinaryCause)
	}
	if ordinaryCause == entitledCause {
		t.Fatal("the two must never collapse to one cause")
	}
}

func TestActivateEntitlementSQL(t *testing.T) {
	sql := activateEntitlementSQL(`abc'def`)
	for _, want := range []string{`UPDATE "Organization"`, `abc''def`, `'local-dev-organization'`} {
		if !strings.Contains(sql, want) {
			t.Errorf("activateEntitlementSQL missing %q:\n%s", want, sql)
		}
	}
}

func TestReadLocalDevEnterpriseLicenseKey(t *testing.T) {
	t.Run("given a checkout whose seed file declares the constant", func(t *testing.T) {
		dir := t.TempDir()
		seedDir := filepath.Join(dir, filepath.Dir(localDevLicenseSeedPath))
		if err := os.MkdirAll(seedDir, 0o750); err != nil {
			t.Fatal(err)
		}
		content := "export const LOCAL_DEV_ENTERPRISE_LICENSE_KEY =\n  \"eyJhbGciOiJ0ZXN0In0=\";\n"
		if err := os.WriteFile(filepath.Join(dir, localDevLicenseSeedPath), []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}

		key, err := readLocalDevEnterpriseLicenseKey(dir)
		if err != nil {
			t.Fatal(err)
		}
		if key != "eyJhbGciOiJ0ZXN0In0=" {
			t.Fatalf("key = %q", key)
		}
	})

	t.Run("given a checkout with no such file", func(t *testing.T) {
		if _, err := readLocalDevEnterpriseLicenseKey(t.TempDir()); err == nil {
			t.Fatal("a missing seed file must error, not silently entitle nothing")
		}
	})

	t.Run("given a checkout whose file no longer declares the constant in the expected shape", func(t *testing.T) {
		dir := t.TempDir()
		seedDir := filepath.Join(dir, filepath.Dir(localDevLicenseSeedPath))
		if err := os.MkdirAll(seedDir, 0o750); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, localDevLicenseSeedPath), []byte("export const SOMETHING_ELSE = 1;"), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := readLocalDevEnterpriseLicenseKey(dir); err == nil {
			t.Fatal("a reshaped export must fail loudly rather than entitle nothing")
		}
	})
}

// Reads the REAL repository file: if LOCAL_DEV_ENTERPRISE_LICENSE_KEY's
// declaration ever moves or reshapes, this fails loudly instead of the
// entitled pass silently activating nothing on every future run.
func TestReadLocalDevEnterpriseLicenseKeyAgainstTheRealRepository(t *testing.T) {
	repoRoot := filepath.Join("..", "..")
	key, err := readLocalDevEnterpriseLicenseKey(repoRoot)
	if err != nil {
		t.Fatalf("the real %s must still declare LOCAL_DEV_ENTERPRISE_LICENSE_KEY in the expected shape: %v", localDevLicenseSeedPath, err)
	}
	if len(key) < 100 {
		t.Fatalf("extracted key looks truncated (%d chars)", len(key))
	}
}

func TestBuildEntitlementActivatorAppliesTheKeyToBothInstances(t *testing.T) {
	dir := t.TempDir()
	seedDir := filepath.Join(dir, filepath.Dir(localDevLicenseSeedPath))
	if err := os.MkdirAll(seedDir, 0o750); err != nil {
		t.Fatal(err)
	}
	content := "export const LOCAL_DEV_ENTERPRISE_LICENSE_KEY =\n  \"eyJhbGciOiJ0ZXN0In0=\";\n"
	if err := os.WriteFile(filepath.Join(dir, localDevLicenseSeedPath), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}

	recorder := &recordingRunner{}
	state := externalBootState(recorder, BootConfig{BranchDir: dir})
	state.runID = "testrun"
	state.override = "/tmp/compose.apidiff.yml" // routes pgAdminDB through the recorded runner, no real docker/psql

	activate := state.buildEntitlementActivator()
	if activate == nil {
		t.Fatal("a readable seed file must produce an activator")
	}
	if err := activate(context.Background()); err != nil {
		t.Fatal(err)
	}

	var sawBranch, sawMain bool
	for _, spec := range recorder.commands {
		joined := strings.Join(spec.args, " ")
		if !strings.Contains(joined, `eyJhbGciOiJ0ZXN0In0=`) || !strings.Contains(joined, `UPDATE "Organization"`) {
			continue
		}
		if strings.Contains(joined, "apidiff_testrun_branch") {
			sawBranch = true
		}
		if strings.Contains(joined, "apidiff_testrun_main") {
			sawMain = true
		}
	}
	if !sawBranch || !sawMain {
		t.Fatalf("expected an UPDATE against both instances' databases, got: %+v", recorder.commands)
	}
}

func TestBuildEntitlementActivatorDisabledWhenSeedFileIsMissing(t *testing.T) {
	var stderr bytes.Buffer
	state := externalBootState(&recordingRunner{}, BootConfig{BranchDir: t.TempDir()})
	state.stderr = &stderr

	if activate := state.buildEntitlementActivator(); activate != nil {
		t.Fatal("a missing seed file must disable the activator, not panic or crash the run")
	}
	if !strings.Contains(stderr.String(), "entitled pass: disabled") {
		t.Fatalf("stderr missing the disabled note: %q", stderr.String())
	}
}

// --- test helpers ---

func mustFetchSpec(t *testing.T, server *httptest.Server) map[string]any {
	t.Helper()
	spec, _, err := FetchSpec(context.Background(), server.Client(), server.URL)
	if err != nil {
		t.Fatal(err)
	}
	return spec
}

func mustUnion(t *testing.T, candidate, base *httptest.Server) []Operation {
	t.Helper()
	specA := mustFetchSpec(t, candidate)
	specB := mustFetchSpec(t, base)
	operationsA, err := Operations(specA)
	if err != nil {
		t.Fatal(err)
	}
	operationsB, err := Operations(specB)
	if err != nil {
		t.Fatal(err)
	}
	return UnionOperations(operationsA, operationsB)
}

func findTranscript(transcripts []Transcript, caseName string) (Transcript, bool) {
	for index := range transcripts {
		if transcripts[index].Case == caseName {
			return transcripts[index], true
		}
	}
	return Transcript{}, false
}

func hasFinding(findings []Finding, match func(Finding) bool) bool {
	_, ok := firstFinding(findings, match)
	return ok
}

func firstFinding(findings []Finding, match func(Finding) bool) (Finding, bool) {
	for _, finding := range findings {
		if match(finding) {
			return finding, true
		}
	}
	return Finding{}, false
}
