package httpapi

import (
	"net/http"
	"testing"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

/** @scenario A request with no end-user id is rejected while a template is active */
func TestEndUserRequiredIsACustomerFacing400(t *testing.T) {
	registerErrorStatuses()

	if got := herr.HTTPStatus(herr.New(t.Context(), domain.ErrEndUserRequired, nil)); got != http.StatusBadRequest {
		t.Fatalf("end_user_required status = %d, want 400: unregistered it falls to 500 and reads as a platform bug", got)
	}
	if got := faultForCode(domain.ErrEndUserRequired); got != FaultCustomer {
		t.Fatalf("end_user_required fault = %q, want customer: the caller omitted the id, nothing is broken on the platform", got)
	}
}
