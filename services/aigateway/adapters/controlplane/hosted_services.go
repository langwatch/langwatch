package controlplane

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

const (
	hostedServicesPath = "/api/internal/gateway/connect"
	// hostedServiceMaxResponseBytes bounds what one answer may carry back. A
	// judgement is a few hundred bytes per question.
	hostedServiceMaxResponseBytes = 4 << 20
)

// hostedServiceEnvelope is what the control plane receives: who the gateway
// resolved the caller to, and the caller's own JSON untouched. The identity
// sits outside `payload`, so nothing the caller sends can overwrite it.
type hostedServiceEnvelope struct {
	VirtualKeyID   string          `json:"virtual_key_id"`
	OrganizationID string          `json:"organization_id"`
	ProjectID      string          `json:"project_id"`
	Payload        json.RawMessage `json:"payload"`
}

// CallHostedService carries one hosted-service call to the control plane over
// the signed channel and relays the answer as it came, status included. The
// control plane's refusals already speak the error envelope the gateway uses,
// so re-encoding them here could only lose detail.
//
// Only a control plane that could not be reached, or that failed on its own
// side, becomes a gateway error: a 5xx from it is an outage of ours and must
// not be shown to the caller as the hosted service's answer.
func (c *Client) CallHostedService(ctx context.Context, call domain.HostedServiceRequest) (domain.HostedServiceResponse, error) {
	payload := json.RawMessage(call.Body)
	if len(payload) == 0 {
		payload = json.RawMessage("null")
	}
	if !json.Valid(payload) {
		return domain.HostedServiceResponse{}, herr.New(ctx, domain.ErrBadRequest, herr.M{
			"message": "the request body is not valid JSON",
			"fault":   "customer",
		})
	}
	body, err := json.Marshal(hostedServiceEnvelope{
		VirtualKeyID:   call.VirtualKeyID,
		OrganizationID: call.OrganizationID,
		ProjectID:      call.ProjectID,
		Payload:        payload,
	})
	if err != nil {
		return domain.HostedServiceResponse{}, herr.New(ctx, domain.ErrInternal, nil, err)
	}

	path, err := url.JoinPath(hostedServicesPath, url.PathEscape(string(call.Operation)))
	if err != nil {
		return domain.HostedServiceResponse{}, herr.New(ctx, domain.ErrInternal, nil, err)
	}
	resp, err := c.signedPost(ctx, path, body)
	if err != nil {
		return domain.HostedServiceResponse{}, herr.New(ctx, domain.ErrHostedServiceUnavailable, nil, err)
	}
	defer func() { _ = resp.Body.Close() }()
	answer, _ := io.ReadAll(io.LimitReader(resp.Body, hostedServiceMaxResponseBytes))

	if resp.StatusCode >= http.StatusInternalServerError {
		return domain.HostedServiceResponse{}, herr.New(ctx, domain.ErrHostedServiceUnavailable, nil,
			fmt.Errorf("control plane returned %d for hosted service %s", resp.StatusCode, call.Operation))
	}
	return domain.HostedServiceResponse{StatusCode: resp.StatusCode, Body: answer}, nil
}
