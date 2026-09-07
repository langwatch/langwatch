package main

import (
	"strings"
	"testing"
)

// @scenario "The combined Go process hosts the data-plane services"
func TestCombinedHostsEveryDataPlaneServiceByDefault(t *testing.T) {
	selected, err := selectCombinedServices(nil)
	if err != nil {
		t.Fatalf("selectCombinedServices(nil) = %v, want no error", err)
	}
	var names []string
	for _, svc := range selected {
		names = append(names, svc.Name)
	}
	if strings.Join(names, ",") != "aigateway,nlpgo" {
		t.Fatalf("combined hosts %v, want aigateway and nlpgo", names)
	}
	if _, ok := services[combinedCommand]; !ok {
		t.Fatal("`service combined` is not a dispatchable subcommand")
	}
}

// @scenario "The combined Go process keeps each service's telemetry identity"
func TestCombinedKeepsEachServiceTelemetryIdentity(t *testing.T) {
	for _, svc := range combinedServices {
		standalone := serviceTelemetryName(svc.Name)
		if svc.Name == "nlpgo" {
			// nlpgo renames itself inside its own Root; the combined process
			// must report the same public name rather than the subcommand.
			standalone = "langwatch-service-nlp"
		}
		if svc.Telemetry != standalone {
			t.Errorf("%s reports %q in the combined process and %q on its own", svc.Name, svc.Telemetry, standalone)
		}
	}
}

// @scenario "Each hosted service binds the port it was allocated"
func TestCombinedGivesEachServiceItsOwnAddressVariable(t *testing.T) {
	seen := map[string]string{}
	for _, svc := range combinedServices {
		if svc.AddrEnv == "SERVER_ADDR" {
			t.Errorf("%s reads SERVER_ADDR; two listeners in one process cannot share it", svc.Name)
		}
		if other, clash := seen[svc.AddrEnv]; clash {
			t.Errorf("%s and %s both read %s", svc.Name, other, svc.AddrEnv)
		}
		seen[svc.AddrEnv] = svc.Name
	}
}

// @scenario "An unknown combined service is refused by name"
func TestCombinedRefusesAnUnknownService(t *testing.T) {
	_, err := selectCombinedServices([]string{"aigateway", "langyagent"})
	if err == nil {
		t.Fatal("selecting langyagent succeeded; it is not one of the combined services")
	}
	if !strings.Contains(err.Error(), "langyagent") {
		t.Errorf("error %q does not name the service that was refused", err)
	}
}
