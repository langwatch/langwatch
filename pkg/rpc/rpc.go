// Package rpc is a tiny typed HTTP-RPC layer: a verb is a plain method
//
//	func(ctx context.Context, *Req) (*Resp, error)
//
// and the generic adapters here do the plumbing — Decode + validate the body,
// call the verb, then serialize the result (a herr via herr.WriteHTTP, a nil
// *Resp as 204 No Content, else the response as JSON). A verb that returns
// (nil, nil) is a 204; a verb that returns a herr is that herr's envelope. This
// keeps every handler down to "Decode → act"; the transport plumbing lives once.
//
// Streaming verbs (an arbitrarily long response body) do NOT fit this shape and
// stay bespoke http.HandlerFuncs in the service. This package depends only on the
// shared toolkit (herr) + go-playground/validator, so any service's transport can
// build on it.
package rpc

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/langwatch/langwatch/pkg/herr"
)

// Handle adapts a typed verb that returns a response body. The body is decoded +
// validated into Req; a herr (from Decode or the verb) is written as the herr
// envelope; a nil *Resp becomes 204 No Content; otherwise the response is
// JSON-encoded.
func Handle[Req, Resp any](maxBodyBytes int64, fn func(context.Context, *Req) (*Resp, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		req, err := Decode[Req](w, r, maxBodyBytes)
		if err != nil {
			herr.WriteHTTP(w, err)
			return
		}
		resp, err := fn(r.Context(), &req)
		if err != nil {
			herr.WriteHTTP(w, err)
			return
		}
		if resp == nil {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}

// HandleNoContent adapts a typed verb with no response body: success is 204 No
// Content, a herr (from Decode or the verb) is written as the herr envelope.
func HandleNoContent[Req any](maxBodyBytes int64, fn func(context.Context, *Req) error) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		req, err := Decode[Req](w, r, maxBodyBytes)
		if err != nil {
			herr.WriteHTTP(w, err)
			return
		}
		if err := fn(r.Context(), &req); err != nil {
			herr.WriteHTTP(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
