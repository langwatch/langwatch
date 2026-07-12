package domain

import (
	"context"
	"net/http"
	"testing"

	"github.com/langwatch/langwatch/pkg/herr"
)

func TestRegisterStatuses_MapsSurfaceCodes(t *testing.T) {
	RegisterStatuses()

	cases := []struct {
		code herr.Code
		want int
	}{
		{ErrUnauthorized, http.StatusUnauthorized},
		{ErrInvalidConversationID, http.StatusBadRequest},
		{ErrConversationBusy, http.StatusConflict},
		{ErrMaxWorkers, http.StatusServiceUnavailable},
		{ErrNoFreeUID, http.StatusServiceUnavailable},
		{ErrSessionNotFound, http.StatusNotFound},
		{ErrInternal, http.StatusInternalServerError},
	}
	for _, c := range cases {
		e := herr.New(context.Background(), c.code, nil)
		if got := herr.HTTPStatus(e); got != c.want {
			t.Errorf("HTTPStatus(%s) = %d, want %d", c.code, got, c.want)
		}
	}
}

func TestErrorCodes_AreErrorsIsComparable(t *testing.T) {
	// A herr.E built with ErrMaxWorkers must satisfy errors.Is against the bare
	// Code — the app relies on this for the at-capacity branch, exactly as the
	// flat manager relied on its errors.New sentinel.
	e := herr.New(context.Background(), ErrMaxWorkers, nil)
	if !herr.IsCode(e, ErrMaxWorkers) {
		t.Errorf("herr(ErrMaxWorkers) should match ErrMaxWorkers via errors.Is")
	}
	if herr.IsCode(e, ErrSessionNotFound) {
		t.Errorf("herr(ErrMaxWorkers) must NOT match a different code")
	}
}
