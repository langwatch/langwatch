package outboundsim

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"
)

// vapidHeader signs claims for aud as a push sender does (ES256, raw r||s) under a fresh key.
func vapidHeader(t *testing.T, aud string, exp time.Time) string {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	enc := base64.RawURLEncoding
	claims, _ := json.Marshal(map[string]any{"aud": aud, "exp": exp.Unix(), "sub": "https://app.example"})
	signing := enc.EncodeToString([]byte(`{"typ":"JWT","alg":"ES256"}`)) + "." + enc.EncodeToString(claims)
	digest := sha256.Sum256([]byte(signing))
	r, s, err := ecdsa.Sign(rand.Reader, key, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	sig := make([]byte, 64)
	r.FillBytes(sig[:32])
	s.FillBytes(sig[32:])
	public, err := key.PublicKey.Bytes()
	if err != nil {
		t.Fatal(err)
	}
	return "vapid t=" + signing + "." + enc.EncodeToString(sig) + ", k=" + enc.EncodeToString(public)
}

func pushHeaders(auth string) map[string]string {
	return map[string]string{"Authorization": auth, "TTL": "60", "Content-Encoding": "aes128gcm", "Topic": "t1", "Urgency": "normal"}
}

// @scenario "Outboundsim is a push service that records each send per device"
func TestPushAcceptsSignedSendsAndTalliesPerDevice(t *testing.T) {
	g := newRig(t, Config{})
	exp := g.s.now().Add(time.Hour)
	for _, device := range []string{"laptop", "laptop", "phone"} {
		got := g.do(http.MethodPost, "/push/"+device, pushHeaders(vapidHeader(t, g.url, exp)), "ciphertext")
		if got.status != http.StatusCreated || got.header.Get("Location") == "" {
			t.Fatalf("%s send = %d %s", device, got.status, got.body)
		}
	}
	var list struct {
		Devices []PushDevice `json:"devices"`
	}
	decode(t, g.do(http.MethodGet, "/_sim/api/push", nil, "").body, &list)
	if len(list.Devices) != 2 || list.Devices[0].Device != "laptop" || list.Devices[0].Delivered != 2 || list.Devices[1].Sends != 1 {
		t.Fatalf("devices = %+v", list.Devices)
	}
	if rec := g.records("channel=push&target=phone"); len(rec) != 1 || rec[0].Parsed["topic"] != "t1" {
		t.Fatalf("phone records = %+v", rec)
	}
}

// @scenario "Outboundsim is a push service that records each send per device"
func TestPushRefusesBadVapidAndAnswersGoneDevices(t *testing.T) {
	g := newRig(t, Config{})
	exp := g.s.now().Add(time.Hour)
	if got := g.do(http.MethodPost, "/push/laptop", pushHeaders("vapid t=a.b.c, k=AAAA"), "x"); got.status != http.StatusForbidden {
		t.Fatalf("bad signature = %d, want 403", got.status)
	}
	if got := g.do(http.MethodPost, "/push/laptop", pushHeaders(vapidHeader(t, "https://elsewhere.example", exp)), "x"); got.status != http.StatusForbidden ||
		!strings.Contains(got.body, "aud") {
		t.Fatalf("wrong aud = %d %s", got.status, got.body)
	}
	if got := g.do(http.MethodPost, "/push/device-gone-1", pushHeaders(vapidHeader(t, g.url, exp)), "x"); got.status != http.StatusGone {
		t.Fatalf("gone device = %d, want 410", got.status)
	}
	if got := g.do(http.MethodPut, "/_sim/api/push/laptop", nil, `{"status":404}`); got.status != http.StatusOK {
		t.Fatalf("set answer = %d %s", got.status, got.body)
	}
	if got := g.do(http.MethodPost, "/push/laptop", pushHeaders(vapidHeader(t, g.url, exp)), "x"); got.status != http.StatusNotFound {
		t.Fatalf("told-404 device = %d", got.status)
	}
	g.do(http.MethodDelete, "/_sim/api/push/laptop", nil, "")
	if got := g.do(http.MethodPost, "/push/laptop", pushHeaders(vapidHeader(t, g.url, exp)), "x"); got.status != http.StatusCreated {
		t.Fatalf("cleared device = %d", got.status)
	}
	noTTL := pushHeaders(vapidHeader(t, g.url, exp))
	delete(noTTL, "TTL")
	if got := g.do(http.MethodPost, "/push/laptop", noTTL, "x"); got.status != http.StatusBadRequest {
		t.Fatalf("no TTL = %d, want 400", got.status)
	}
}
