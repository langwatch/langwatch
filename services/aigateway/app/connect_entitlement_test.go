package app

import (
	"context"
	"testing"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/app/pipeline"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Spec: specs/self-hosting/connected-services/managed-models-provider.feature
// The LangWatch Cloud leg: a license token reaches the platform's own models
// only while its contract includes managed models.

func connectCall(services []string) *pipeline.Call {
	return &pipeline.Call{
		Bundle: &domain.Bundle{
			VirtualKeyID:    "vk-connect-1",
			OrganizationID:  "org-customer-1",
			ConnectServices: services,
		},
		Request: &domain.Request{Type: domain.RequestTypeChat, Model: "gpt-5-mini"},
	}
}

// @scenario "A license without the managed models entitlement is refused"
func TestLicenseWithoutManagedModelsIsRefusedBeforeProviderResolution(t *testing.T) {
	_, err := (&App{}).candidateChain(context.Background(), connectCall([]string{"instant_evals"}))

	if !herr.IsCode(err, domain.ErrConnectServiceNotEntitled) {
		t.Fatalf("err = %v, want connect_service_not_entitled", err)
	}
	// The refusal has to beat the chain walk. A license reaches no provider of
	// its own, so resolving first would answer "no model provider configured",
	// which names something the operator cannot act on.
	if herr.IsCode(err, domain.ErrNoProviderConfigured) {
		t.Errorf("the chain was resolved before the entitlement was checked")
	}
}

func TestALicenseEntitledToNothingIsRefusedTheSameWay(t *testing.T) {
	_, err := (&App{}).candidateChain(context.Background(), connectCall([]string{}))

	if !herr.IsCode(err, domain.ErrConnectServiceNotEntitled) {
		t.Fatalf("err = %v, want connect_service_not_entitled", err)
	}
}

func TestAnEntitledLicenseIsNotRefusedByTheEntitlementCheck(t *testing.T) {
	_, err := (&App{}).candidateChain(
		context.Background(),
		connectCall([]string{"instant_evals", domain.ConnectServiceManagedModels}),
	)

	if herr.IsCode(err, domain.ErrConnectServiceNotEntitled) {
		t.Fatalf("an entitled license was refused the service its contract includes")
	}
	// It carries no credential in this fixture, so it lands on the ordinary
	// empty-chain answer, which is what proves the check let it through.
	if !herr.IsCode(err, domain.ErrNoProviderConfigured) {
		t.Fatalf("err = %v, want the ordinary empty-chain answer", err)
	}
}

func TestAVirtualKeyIsNeverJudgedAgainstLicenseEntitlements(t *testing.T) {
	call := connectCall(nil)

	_, err := (&App{}).candidateChain(context.Background(), call)

	if herr.IsCode(err, domain.ErrConnectServiceNotEntitled) {
		t.Fatalf("a virtual key was refused a hosted service it never asked for")
	}
	if !herr.IsCode(err, domain.ErrNoProviderConfigured) {
		t.Fatalf("err = %v, want the ordinary empty-chain answer", err)
	}
}
