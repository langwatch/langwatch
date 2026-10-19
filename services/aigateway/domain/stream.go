package domain

import "context"

// StreamHeaderer is an optional StreamIterator extension for streams whose
// response head comes from the provider: binary audio and vendor SSE. The
// writer sends these headers before the first chunk.
type StreamHeaderer interface {
	StreamHeaders() map[string]string
}

// StreamUnwrapper is implemented by every iterator that wraps another, so an
// optional extension on the innermost iterator stays reachable.
type StreamUnwrapper interface {
	Unwrap() StreamIterator
}

// StreamHeadersOf returns the provider response headers of a stream, looking
// through wrappers. Nil when no iterator in the chain states any.
func StreamHeadersOf(iter StreamIterator) map[string]string {
	for iter != nil {
		if h, ok := iter.(StreamHeaderer); ok {
			return h.StreamHeaders()
		}
		u, ok := iter.(StreamUnwrapper)
		if !ok {
			return nil
		}
		iter = u.Unwrap()
	}
	return nil
}

// BufferedStream presents a complete response as a one-chunk raw stream. It
// serves the providers that cannot stream a route, so the caller reads every
// provider through the same iterator.
func BufferedStream(resp *Response) StreamIterator {
	return &bufferedStream{resp: resp}
}

type bufferedStream struct {
	resp *Response
	read bool
}

func (s *bufferedStream) Next(context.Context) bool {
	if s.read || len(s.resp.Body) == 0 {
		return false
	}
	s.read = true
	return true
}

func (s *bufferedStream) Chunk() []byte                    { return s.resp.Body }
func (s *bufferedStream) Usage() Usage                     { return s.resp.Usage }
func (s *bufferedStream) Err() error                       { return nil }
func (s *bufferedStream) Close() error                     { return nil }
func (s *bufferedStream) RawFraming() bool                 { return true }
func (s *bufferedStream) StreamHeaders() map[string]string { return s.resp.Headers }
