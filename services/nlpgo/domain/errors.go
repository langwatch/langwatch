// Package domain holds the nlpgo service's value objects and error codes.
package domain

import "github.com/langwatch/langwatch/pkg/herr"

// Error codes returned by the Go nlpgo service. Mapped to HTTP statuses in
// adapters/httpapi/router.go via registerErrorStatuses().
const (
	// ErrInvalidWorkflow signals a malformed workflow JSON (cycles,
	// unknown node ids on edges, column-length mismatches in a dataset).
	ErrInvalidWorkflow = herr.Code("invalid_workflow")

	// ErrInvalidDataset signals dataset-specific validation failures
	// (column length mismatch, entry_selection out of range, split sizes
	// exceeding row count).
	ErrInvalidDataset = herr.Code("invalid_dataset")

	// ErrUnsupportedNodeKind signals the workflow contains a node kind
	// not yet supported by the Go engine (agent, evaluator, retriever,
	// custom). Triggers a 501 so the TS app can fall back to Python.
	ErrUnsupportedNodeKind = herr.Code("unsupported_node_kind")

	// ErrUnauthorized signals a missing or invalid HMAC signature on a
	// /go/* request.
	ErrUnauthorized = herr.Code("unauthorized")

	// ErrBadRequest is the catch-all for shape errors that don't have a
	// more specific code.
	ErrBadRequest = herr.Code("bad_request")

	// ErrNotFound is returned by handlers that match no resource.
	ErrNotFound = herr.Code("not_found")

	// ErrInternal is the generic fallback for unexpected errors.
	ErrInternal = herr.Code("internal_error")

	// ErrIdleTimeout signals the SSE stream went silent past
	// NLP_STREAM_IDLE_TIMEOUT_SECONDS and the engine closed the
	// connection.
	ErrIdleTimeout = herr.Code("idle_timeout")

	// ErrCodeBlockTimeout signals the user code subprocess exceeded
	// NLP_CODE_BLOCK_TIMEOUT_SECONDS and was killed.
	ErrCodeBlockTimeout = herr.Code("code_block_timeout")

	// ErrSSRFBlocked signals an HTTP block tried to reach a destination
	// disallowed by the SSRF policy (loopback, private, link-local,
	// metadata).
	ErrSSRFBlocked = herr.Code("ssrf_blocked")

	// ErrJSONPathNoMatch signals an HTTP block's output_path matched no
	// element of the upstream response.
	ErrJSONPathNoMatch = herr.Code("jsonpath_no_match")

	// ErrUpstreamHTTP signals a non-2xx from an HTTP block's upstream.
	ErrUpstreamHTTP = herr.Code("upstream_http_error")

	// ErrChildUnavailable signals the uvicorn child process is down or
	// unreachable.
	ErrChildUnavailable = herr.Code("child_unavailable")

	// ErrGatewayUnavailable signals the AI Gateway returned an error or
	// is unreachable.
	ErrGatewayUnavailable = herr.Code("gateway_unavailable")
)
