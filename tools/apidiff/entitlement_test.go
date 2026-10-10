package apidiff

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
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

		t.Run("when the entitled pass runs with no ActivateEntitlement (probe mode, or a deferred boot)", func(t *testing.T) {
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

// entitlementBooted is the pair of instances the activator reads and writes.
func entitlementBooted() *Booted {
	return &Booted{A: Instance{Name: "branch", Dir: "/wt/branch"}, B: Instance{Name: "main", Dir: "/wt/main"}}
}

// @scenario "The entitled pass copies the licence the branch seed signed onto both databases"
func TestBuildEntitlementActivatorCopiesTheBranchLicenceToBothInstances(t *testing.T) {
	recorder := &recordingRunner{output: "eyJhbGciOiJ0ZXN0In0=\n"}
	state := externalBootState(recorder, BootConfig{BranchDir: t.TempDir()})
	state.override = "/tmp/compose.apidiff.yml" // routes pgQueryDB through the recorded runner, no real docker/psql

	activate := state.buildEntitlementActivator(context.Background(), entitlementBooted())
	if activate == nil {
		t.Fatal("a licence stored by the branch seed must produce an activator")
	}
	if !updatedBoth(recorder.commands, "apidiff_testrun_branch", "apidiff_testrun_main") {
		t.Fatalf("boot must entitle both sides at once; got: %+v", recorder.commands)
	}
	recorder.commands = nil
	if err := activate(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !updatedBoth(recorder.commands, "apidiff_testrun_branch", "apidiff_testrun_main") {
		t.Fatalf("expected an UPDATE against both instances' databases, got: %+v", recorder.commands)
	}
}

// @scenario "The entitled pass is deferred on both sides when no licence keys are configured"
func TestBuildEntitlementActivatorDeferredWhenTheBranchStoredNoLicence(t *testing.T) {
	var stderr bytes.Buffer
	recorder := &recordingRunner{}
	state := externalBootState(recorder, BootConfig{BranchDir: t.TempDir()})
	state.override = "/tmp/compose.apidiff.yml"
	state.stderr = &stderr

	if activate := state.buildEntitlementActivator(context.Background(), entitlementBooted()); activate != nil {
		t.Fatal("no stored licence must defer the pass, not activate an empty one")
	}
	if strings.Count(stderr.String(), "\n") != 1 || !strings.Contains(stderr.String(), "entitled pass: deferred:") || !strings.Contains(stderr.String(), "LANGWATCH_LICENSE_PRIVATE_KEY") {
		t.Fatalf("stderr must be one deferral line naming the keys: %q", stderr.String())
	}
	var clearedMain bool
	for _, spec := range recorder.commands {
		joined := strings.Join(spec.args, " ")
		if strings.Contains(joined, "UPDATE") && strings.Contains(joined, "apidiff_testrun_branch") {
			t.Fatalf("a deferred pass must not touch the branch, got: %+v", recorder.commands)
		}
		clearedMain = clearedMain || (strings.Contains(joined, `SET "license" = NULL`) && strings.Contains(joined, "apidiff_testrun_main"))
	}
	if !clearedMain {
		t.Fatalf("main's own seeded licence must be cleared so it is not entitled alone, got: %+v", recorder.commands)
	}
}

// @scenario "The entitled pass reaches haven stacks through haven db url"
func TestBuildEntitlementActivatorOnTheHavenPathUsesEachStacksDatabase(t *testing.T) {
	var commands []commandSpec
	state := externalBootState(&recordingRunner{}, BootConfig{BranchDir: t.TempDir(), UseHaven: true})
	state.run = func(_ context.Context, spec commandSpec, log io.Writer) error {
		commands = append(commands, spec)
		answer := "eyJhbGciOiJ0ZXN0In0=\n"
		if spec.name == havenCommand {
			answer = "postgres://prisma:pw@127.0.0.1:5432/" + spec.dir[len("/wt/"):] + "\n"
		}
		_, err := io.WriteString(log, answer)
		return err
	}

	if activate := state.buildEntitlementActivator(context.Background(), entitlementBooted()); activate == nil {
		t.Fatal("a licence stored by the branch stack must produce an activator on the haven path too")
	}
	if !updatedBoth(commands, "127.0.0.1:5432/branch", "127.0.0.1:5432/main") {
		t.Fatalf("expected psql UPDATEs against both stacks' haven db url, got: %+v", commands)
	}
	for _, spec := range commands {
		if spec.name != havenCommand {
			continue
		}
		slug := HavenSlug("testrun", spec.dir[len("/wt/"):])
		if !slices.Contains(spec.env, "LANGWATCH_SLUG="+slug) {
			t.Fatalf("haven db url in %s must name its own stack %s", spec.dir, slug)
		}
	}
}

// updatedBoth reports whether the recorded commands UPDATE the test licence
// onto both databases, told apart by the given argument fragments.
func updatedBoth(commands []commandSpec, branch, main string) bool {
	var sawBranch, sawMain bool
	for _, spec := range commands {
		joined := strings.Join(spec.args, " ")
		if !strings.Contains(joined, `eyJhbGciOiJ0ZXN0In0=`) || !strings.Contains(joined, `UPDATE "Organization"`) {
			continue
		}
		sawBranch = sawBranch || strings.Contains(joined, branch)
		sawMain = sawMain || strings.Contains(joined, main)
	}
	return sawBranch && sawMain
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
