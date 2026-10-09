package client

import (
	"context"
	"errors"
	"net/http"

	"github.com/langwatch/langwatch/sdks/go/client/internal/openapi"
)

// AnnotationsService is the client for human annotations attached to traces.
//
// Access it via [Client.Annotations].
type AnnotationsService struct {
	client *Client
}

// Annotation is a human annotation on a trace, re-exported from the API's shared
// schema.
type Annotation = openapi.Annotation

// errNoDataEnvelope is the cause reported when an annotations response decodes
// cleanly but carried no "data" key at all.
var errNoDataEnvelope = errors.New(`response carried no "data" envelope`)

// annotationEnvelope is the {"data": …} wrapper every annotations endpoint
// returns except Delete.
//
// Data is a pointer on purpose. JSON decoding ignores unknown keys, so a 2xx
// body in some other shape — an older self-hosted server still returning the
// bare value, or a future one that moves the payload again — decodes without
// error and leaves Data nil. Decoding into a value instead would hand the
// caller a zero-valued Annotation and no error, which is the silent failure
// this envelope handling exists to prevent.
type annotationEnvelope[T any] struct {
	Data *T `json:"data"`
}

// decodeAnnotationEnvelope decodes a data-enveloped annotations response, and
// refuses one whose body carried no envelope.
func decodeAnnotationEnvelope[T any](operation string, resp *http.Response, err error) (*T, error) {
	var env annotationEnvelope[T]
	if derr := decodeInto(operation, resp, err, &env); derr != nil {
		return nil, derr
	}
	// decodeInto only returns nil once it has seen a 2xx, so resp is non-nil
	// here. An empty body reaches this point too: decodeInto treats io.EOF as
	// "nothing to decode", which leaves Data nil and is equally not an answer.
	if env.Data == nil {
		return nil, newDecodeError(operation, resp, errNoDataEnvelope)
	}
	return env.Data, nil
}

// AnnotationParams is the body for creating or updating an annotation.
//
// Comment and IsThumbsUp are both REQUIRED by the API, on create and on update
// alike: it rejects a body missing either with 400. They carry omitempty, so a
// zero Comment or a nil IsThumbsUp is dropped from the request rather than sent
// as an empty value — which means an empty comment cannot be written, and a
// call that sets only one of the two is rejected. Set both.
type AnnotationParams struct {
	// Comment is free-text feedback. Required; must be non-empty.
	Comment string `json:"comment,omitempty"`
	// IsThumbsUp records a thumbs-up/down. Required; pass a pointer so the value
	// is sent explicitly, because a nil is omitted from the body and rejected.
	IsThumbsUp *bool `json:"isThumbsUp,omitempty"`
	// Email attributes the annotation to a user.
	Email string `json:"email,omitempty"`
	// ScoreOptions carries structured scores keyed by annotation-score id.
	//
	// Note: the public REST endpoint that backs annotation creation currently
	// ignores this field (it reads only comment/isThumbsUp/email); it is sent so
	// callers are forward-compatible as the API gains score support. Set scores
	// via the LangWatch UI today if you need them persisted.
	ScoreOptions map[string]any `json:"scoreOptions,omitempty"`
}

// List returns every annotation in the project.
//
//	annotations, err := lw.Annotations.List(ctx)
func (s *AnnotationsService) List(ctx context.Context) ([]Annotation, error) {
	resp, err := s.client.gen.GetApiAnnotations(ctx, nil)
	data, derr := decodeAnnotationEnvelope[[]Annotation]("Annotations.List", resp, err)
	if derr != nil {
		return nil, derr
	}
	return *data, nil
}

// Get fetches a single annotation by ID.
//
//	a, err := lw.Annotations.Get(ctx, "annotation_abc")
func (s *AnnotationsService) Get(ctx context.Context, id string) (*Annotation, error) {
	resp, err := s.client.gen.GetApiAnnotationsId(ctx, id)
	return decodeAnnotationEnvelope[Annotation]("Annotations.Get", resp, err)
}

// ListByTrace returns every annotation attached to a given trace.
//
//	annotations, err := lw.Annotations.ListByTrace(ctx, "trace_abc123")
func (s *AnnotationsService) ListByTrace(ctx context.Context, traceID string) ([]Annotation, error) {
	resp, err := s.client.gen.GetApiAnnotationsTraceId(ctx, traceID, nil)
	data, derr := decodeAnnotationEnvelope[[]Annotation]("Annotations.ListByTrace", resp, err)
	if derr != nil {
		return nil, derr
	}
	return *data, nil
}

// CreateForTrace attaches a new annotation to a trace.
//
//	up := true
//	a, err := lw.Annotations.CreateForTrace(ctx, "trace_abc123", client.AnnotationParams{
//		Comment:    "Great answer",
//		IsThumbsUp: &up,
//	})
func (s *AnnotationsService) CreateForTrace(ctx context.Context, traceID string, params AnnotationParams) (*Annotation, error) {
	body, err := jsonReader(params)
	if err != nil {
		return nil, err
	}
	resp, err := s.client.gen.PostApiAnnotationsTraceIdWithBody(ctx, traceID, contentTypeJSON, body)
	return decodeAnnotationEnvelope[Annotation]("Annotations.CreateForTrace", resp, err)
}

// Update modifies an existing annotation. Both fields are required; see
// [AnnotationParams].
//
//	up := true
//	a, err := lw.Annotations.Update(ctx, "annotation_abc", client.AnnotationParams{
//		Comment:    "Edited",
//		IsThumbsUp: &up,
//	})
func (s *AnnotationsService) Update(ctx context.Context, id string, params AnnotationParams) (*Annotation, error) {
	body, err := jsonReader(params)
	if err != nil {
		return nil, err
	}
	resp, err := s.client.gen.PatchApiAnnotationsIdWithBody(ctx, id, contentTypeJSON, body)
	return decodeAnnotationEnvelope[Annotation]("Annotations.Update", resp, err)
}

// Delete removes an annotation by ID.
//
//	err := lw.Annotations.Delete(ctx, "annotation_abc")
func (s *AnnotationsService) Delete(ctx context.Context, id string) error {
	resp, err := s.client.gen.DeleteApiAnnotationsId(ctx, id)
	return decodeInto("Annotations.Delete", resp, err, nil)
}
