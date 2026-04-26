package auth

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestStartDeviceCode(t *testing.T) {
	var baseURL string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/auth/cli/device-code" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"device_code":      "DC123",
			"user_code":        "ABCD-EFGH",
			"verification_uri": baseURL + "/cli-auth?code=ABCD-EFGH",
			"expires_in":       600,
			"interval":         2,
		})
	}))
	baseURL = srv.URL
	t.Cleanup(srv.Close)

	c := &Client{BaseURL: srv.URL}
	dc, err := c.StartDeviceCode(context.Background())
	if err != nil {
		t.Fatalf("StartDeviceCode: %v", err)
	}
	if dc.DeviceCode != "DC123" {
		t.Errorf("got DeviceCode %q", dc.DeviceCode)
	}
	if dc.Interval != 2 {
		t.Errorf("got Interval %d", dc.Interval)
	}
}

func TestExchangeStatusCodes(t *testing.T) {
	cases := []struct {
		name    string
		status  int
		want    error
		body    string
		wantOK  bool
	}{
		{name: "pending", status: http.StatusPreconditionRequired, want: ErrPending},
		{name: "denied", status: http.StatusGone, want: ErrDenied},
		{name: "expired", status: http.StatusRequestTimeout, want: ErrExpired},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(`{"status":"` + tc.name + `"}`))
			}))
			defer srv.Close()
			c := &Client{BaseURL: srv.URL}
			_, err := c.Exchange(context.Background(), "DC123")
			if !errors.Is(err, tc.want) {
				t.Errorf("got err %v want %v", err, tc.want)
			}
		})
	}
}

func TestPollUntilDoneSuccess(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		n := atomic.AddInt32(&calls, 1)
		if n < 2 {
			w.WriteHeader(http.StatusPreconditionRequired)
			_, _ = w.Write([]byte(`{}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"access_token":  "at_x",
			"refresh_token": "rt_x",
			"expires_in":    3600,
			"user":          map[string]string{"id": "u_1", "email": "j@miro.com", "name": "Jane"},
			"organization":  map[string]string{"id": "o_1", "slug": "miro", "name": "Miro"},
			"default_personal_vk": map[string]string{
				"id":     "vk_1",
				"secret": "lw_vk_xxx",
				"prefix": "lw_vk_x",
			},
		})
	}))
	t.Cleanup(srv.Close)

	c := &Client{BaseURL: srv.URL}
	dc := &DeviceCode{
		DeviceCode: "DC",
		Interval:   1, // 1s for test speed
		ExpiresIn:  10,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	got, err := c.PollUntilDone(ctx, dc)
	if err != nil {
		t.Fatalf("PollUntilDone: %v", err)
	}
	if got.AccessToken != "at_x" {
		t.Errorf("got AccessToken %q", got.AccessToken)
	}
	if got.User.Email != "j@miro.com" {
		t.Errorf("got User.Email %q", got.User.Email)
	}
	if got.DefaultPersonalVK.Secret != "lw_vk_xxx" {
		t.Errorf("got VK.Secret %q", got.DefaultPersonalVK.Secret)
	}
}

func TestPollUntilDoneDenied(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusGone)
		_, _ = w.Write([]byte(`{"status":"denied"}`))
	}))
	t.Cleanup(srv.Close)

	c := &Client{BaseURL: srv.URL}
	dc := &DeviceCode{DeviceCode: "DC", Interval: 1, ExpiresIn: 10}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	_, err := c.PollUntilDone(ctx, dc)
	if !errors.Is(err, ErrDenied) {
		t.Errorf("got err %v want ErrDenied", err)
	}
}

func TestExchangeSlowDown(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"error":"slow_down"}`))
	}))
	t.Cleanup(srv.Close)

	c := &Client{BaseURL: srv.URL}
	_, err := c.Exchange(context.Background(), "DC")
	if !errors.Is(err, ErrSlowDown) {
		t.Errorf("got %v want ErrSlowDown", err)
	}
}

func TestRefreshUnauthorized(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":"refresh_token_revoked"}`))
	}))
	t.Cleanup(srv.Close)

	c := &Client{BaseURL: srv.URL}
	_, err := c.Refresh(context.Background(), "rt_x")
	if !errors.Is(err, ErrUnauthorized) {
		t.Errorf("got %v want ErrUnauthorized", err)
	}
}

func TestRefresh(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]string
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["refresh_token"] != "rt_x" {
			t.Errorf("got refresh_token %q", body["refresh_token"])
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"access_token":  "at_new",
			"refresh_token": "rt_new",
			"expires_in":    3600,
		})
	}))
	t.Cleanup(srv.Close)

	c := &Client{BaseURL: srv.URL}
	r, err := c.Refresh(context.Background(), "rt_x")
	if err != nil {
		t.Fatalf("Refresh: %v", err)
	}
	if r.AccessToken != "at_new" {
		t.Errorf("got AccessToken %q", r.AccessToken)
	}
}
