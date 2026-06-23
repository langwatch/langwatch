package client

import (
	"context"

	"github.com/langwatch/langwatch/sdk-go/client/internal/openapi"
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

// AnnotationParams is the body for creating or updating an annotation. All
// fields are optional; supply the ones you wish to set.
type AnnotationParams struct {
	// Comment is free-text feedback.
	Comment string `json:"comment,omitempty"`
	// IsThumbsUp records a thumbs-up/down. Pass a pointer to set it explicitly;
	// nil leaves it unset.
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
	resp, err := s.client.gen.GetApiAnnotations(ctx)
	var out []Annotation
	if derr := decodeInto("Annotations.List", resp, err, &out); derr != nil {
		return nil, derr
	}
	return out, nil
}

// Get fetches a single annotation by ID.
//
//	a, err := lw.Annotations.Get(ctx, "annotation_abc")
func (s *AnnotationsService) Get(ctx context.Context, id string) (*Annotation, error) {
	resp, err := s.client.gen.GetApiAnnotationsId(ctx, id)
	var out Annotation
	if derr := decodeInto("Annotations.Get", resp, err, &out); derr != nil {
		return nil, derr
	}
	return &out, nil
}

// ListByTrace returns every annotation attached to a given trace.
//
//	annotations, err := lw.Annotations.ListByTrace(ctx, "trace_abc123")
func (s *AnnotationsService) ListByTrace(ctx context.Context, traceID string) ([]Annotation, error) {
	resp, err := s.client.gen.GetApiAnnotationsTraceId(ctx, traceID)
	var out []Annotation
	if derr := decodeInto("Annotations.ListByTrace", resp, err, &out); derr != nil {
		return nil, derr
	}
	return out, nil
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
	var out Annotation
	if derr := decodeInto("Annotations.CreateForTrace", resp, err, &out); derr != nil {
		return nil, derr
	}
	return &out, nil
}

// Update modifies an existing annotation.
//
//	a, err := lw.Annotations.Update(ctx, "annotation_abc", client.AnnotationParams{Comment: "Edited"})
func (s *AnnotationsService) Update(ctx context.Context, id string, params AnnotationParams) (*Annotation, error) {
	body, err := jsonReader(params)
	if err != nil {
		return nil, err
	}
	resp, err := s.client.gen.PatchApiAnnotationsIdWithBody(ctx, id, contentTypeJSON, body)
	var out Annotation
	if derr := decodeInto("Annotations.Update", resp, err, &out); derr != nil {
		return nil, derr
	}
	return &out, nil
}

// Delete removes an annotation by ID.
//
//	err := lw.Annotations.Delete(ctx, "annotation_abc")
func (s *AnnotationsService) Delete(ctx context.Context, id string) error {
	resp, err := s.client.gen.DeleteApiAnnotationsId(ctx, id)
	return decodeInto("Annotations.Delete", resp, err, nil)
}
