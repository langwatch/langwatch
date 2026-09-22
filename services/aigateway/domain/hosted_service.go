package domain

// HostedServiceOperation names one call a hosted service answers. The value is
// the last path segment of the control plane route that serves it.
type HostedServiceOperation string

const (
	// HostedInstantEvalsClassify judges one text against its questions.
	HostedInstantEvalsClassify HostedServiceOperation = "instant-evals-classify"
	// HostedUsage reads what the caller spent against its cap.
	HostedUsage HostedServiceOperation = "usage"
	// HostedBudget changes the cap a license set on itself.
	HostedBudget HostedServiceOperation = "budget"
)

// HostedServiceRequest is one call to a hosted service, with the identity the
// gateway resolved for the caller. The control plane trusts these fields
// because the channel is signed; nothing the caller sent can set them.
type HostedServiceRequest struct {
	Operation      HostedServiceOperation
	VirtualKeyID   string
	OrganizationID string
	ProjectID      string
	// Body is the caller's JSON, passed through unread.
	Body []byte
}

// HostedServiceResponse is the control plane's answer, relayed as it came.
type HostedServiceResponse struct {
	StatusCode int
	Body       []byte
}
