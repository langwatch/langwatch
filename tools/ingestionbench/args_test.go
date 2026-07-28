package ingestionbench

import (
	"strings"
	"testing"
	"time"
)

func TestParseTenants(t *testing.T) {
	t.Run("given well-formed JSON", func(t *testing.T) {
		t.Run("decodes every tenant", func(t *testing.T) {
			tenants, err := parseTenants(`[{"projectId":"p1","apiKey":"sk-lw-a"},{"projectId":"p2","apiKey":"sk-lw-b"}]`)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(tenants) != 2 {
				t.Fatalf("got %d tenants, want 2", len(tenants))
			}
			if tenants[0].ProjectID != "p1" || tenants[0].APIKey != "sk-lw-a" {
				t.Errorf("first tenant decoded as %+v", tenants[0])
			}
		})

		t.Run("round-trips the shape `ingestionbench seed` prints", func(t *testing.T) {
			plan, err := buildSeedPlan("abc12345", 2)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			encoded := `[{"projectId":"` + plan.Tenants[0].ProjectID + `","apiKey":"` + plan.Tenants[0].APIKey + `"},` +
				`{"projectId":"` + plan.Tenants[1].ProjectID + `","apiKey":"` + plan.Tenants[1].APIKey + `"}]`
			decoded, err := parseTenants(encoded)
			if err != nil {
				t.Fatalf("seed output did not parse back: %v", err)
			}
			if decoded[0] != plan.Tenants[0] {
				t.Errorf("round-trip changed the tenant: %+v vs %+v", decoded[0], plan.Tenants[0])
			}
		})
	})

	t.Run("when fewer than two tenants are supplied", func(t *testing.T) {
		// One tenant makes the cross-tenant isolation and dispatch-fairness
		// checks vacuous — they would report PASS having compared nothing.
		t.Run("rejects a single tenant", func(t *testing.T) {
			_, err := parseTenants(`[{"projectId":"p1","apiKey":"sk-lw-a"}]`)
			if err == nil || !strings.Contains(err.Error(), "at least 2") {
				t.Errorf("got %v, want an at-least-2 error", err)
			}
		})

		t.Run("rejects an empty list", func(t *testing.T) {
			if _, err := parseTenants(`[]`); err == nil {
				t.Error("expected an error for an empty tenant list")
			}
		})
	})

	t.Run("when the input is unusable", func(t *testing.T) {
		t.Run("names the seed command when nothing was passed", func(t *testing.T) {
			_, err := parseTenants("")
			if err == nil || !strings.Contains(err.Error(), "ingestionbench seed") {
				t.Errorf("got %v, want an error pointing at the seed command", err)
			}
		})

		t.Run("rejects malformed JSON", func(t *testing.T) {
			if _, err := parseTenants(`[{"projectId":`); err == nil {
				t.Error("expected an error for malformed JSON")
			}
		})

		t.Run("rejects a tenant missing its api key", func(t *testing.T) {
			_, err := parseTenants(`[{"projectId":"p1"},{"projectId":"p2","apiKey":"sk-lw-b"}]`)
			if err == nil || !strings.Contains(err.Error(), "apiKey") {
				t.Errorf("got %v, want a missing-apiKey error", err)
			}
		})
	})
}

func TestRunArgsValidate(t *testing.T) {
	valid := func() RunArgs {
		return RunArgs{
			ClickHouse:    "http://localhost:8123/bench",
			Scale:         1,
			SettleTimeout: time.Minute,
			Tenants:       []Tenant{{ProjectID: "p1", APIKey: "k1"}, {ProjectID: "p2", APIKey: "k2"}},
		}
	}

	t.Run("given a complete configuration", func(t *testing.T) {
		t.Run("accepts it", func(t *testing.T) {
			if err := valid().validate(); err != nil {
				t.Errorf("unexpected error: %v", err)
			}
		})

		t.Run("accepts a fractional scale, which local runs use", func(t *testing.T) {
			args := valid()
			args.Scale = 0.1
			if err := args.validate(); err != nil {
				t.Errorf("unexpected error: %v", err)
			}
		})
	})

	t.Run("when a dispatch input is nonsensical", func(t *testing.T) {
		cases := []struct {
			name    string
			mutate  func(*RunArgs)
			wantHas string
		}{
			{"rejects a missing ClickHouse URL", func(a *RunArgs) { a.ClickHouse = "" }, "-clickhouse"},
			{"rejects a zero scale, which would plan an empty run", func(a *RunArgs) { a.Scale = 0 }, "-scale"},
			{"rejects a negative scale", func(a *RunArgs) { a.Scale = -1 }, "-scale"},
			{"rejects a zero settle timeout, which would never wait", func(a *RunArgs) { a.SettleTimeout = 0 }, "-settle-timeout"},
			{"rejects a single tenant", func(a *RunArgs) { a.Tenants = a.Tenants[:1] }, "2 tenants"},
		}
		for _, c := range cases {
			t.Run(c.name, func(t *testing.T) {
				args := valid()
				c.mutate(&args)
				err := args.validate()
				if err == nil {
					t.Fatalf("expected an error mentioning %q", c.wantHas)
				}
				if !strings.Contains(err.Error(), c.wantHas) {
					t.Errorf("got %q, want it to mention %q", err.Error(), c.wantHas)
				}
			})
		}
	})
}

func TestSeedArgsValidate(t *testing.T) {
	t.Run("given a database URL and enough projects", func(t *testing.T) {
		t.Run("accepts it", func(t *testing.T) {
			args := seedArgs{DatabaseURL: "postgres://localhost/bench", Count: 4}
			if err := args.validate(); err != nil {
				t.Errorf("unexpected error: %v", err)
			}
		})
	})

	t.Run("when the configuration cannot produce a usable run", func(t *testing.T) {
		t.Run("rejects a missing database URL", func(t *testing.T) {
			args := seedArgs{Count: 4}
			if err := args.validate(); err == nil {
				t.Error("expected an error for a missing database URL")
			}
		})

		t.Run("rejects a single project, mirroring the run-side floor", func(t *testing.T) {
			args := seedArgs{DatabaseURL: "postgres://localhost/bench", Count: 1}
			err := args.validate()
			if err == nil || !strings.Contains(err.Error(), ">= 2") {
				t.Errorf("got %v, want a minimum-of-two error", err)
			}
		})
	})
}
