package netcheck

import (
	"context"
	"errors"
	"net"
	"strings"
	"testing"
	"time"
)

func TestParseHostsHappyPath(t *testing.T) {
	got, err := ParseHosts("api.openai.com:443, api.anthropic.com:443 , generativelanguage.googleapis.com:443")
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	want := []Host{
		{Name: "api", Addr: "api.openai.com:443"},
		{Name: "api", Addr: "api.anthropic.com:443"},
		{Name: "generativelanguage", Addr: "generativelanguage.googleapis.com:443"},
	}
	if len(got) != len(want) {
		t.Fatalf("len=%d want=%d: %+v", len(got), len(want), got)
	}
	for i := range got {
		if got[i] != want[i] {
			t.Errorf("[%d] got %+v want %+v", i, got[i], want[i])
		}
	}
}

func TestParseHostsEmpty(t *testing.T) {
	for _, raw := range []string{"", "   ", ",,,", "  ,  ,"} {
		got, err := ParseHosts(raw)
		if err != nil {
			t.Errorf("%q: err=%v", raw, err)
		}
		if len(got) != 0 {
			t.Errorf("%q: expected empty, got %+v", raw, got)
		}
	}
}

func TestParseHostsInvalid(t *testing.T) {
	for _, raw := range []string{"nohost", "host:", ":443"} {
		if _, err := ParseHosts(raw); err == nil {
			t.Errorf("%q: expected error", raw)
		}
	}
}

func TestProbeSuccess(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			_ = c.Close()
		}
	}()
	p := &Prober{PerHostTimeout: time.Second}
	err = p.Probe(context.Background(), []Host{{Name: "local", Addr: ln.Addr().String()}})
	if err != nil {
		t.Fatalf("probe: %v", err)
	}
}

func TestProbeTCPFailure(t *testing.T) {
	// Grab and release a port so something is guaranteed closed at that port.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := ln.Addr().String()
	ln.Close()

	p := &Prober{PerHostTimeout: 500 * time.Millisecond}
	err = p.Probe(context.Background(), []Host{{Name: "dead", Addr: addr}})
	if err == nil {
		t.Fatal("expected error on dead port")
	}
	if !strings.Contains(err.Error(), "tcp dial failed") {
		t.Errorf("expected tcp dial failed classification, got %v", err)
	}
}

func TestProbeDNSFailure(t *testing.T) {
	// .invalid is RFC 6761 reserved — guaranteed to never resolve.
	p := &Prober{PerHostTimeout: 500 * time.Millisecond}
	err := p.Probe(context.Background(), []Host{{Name: "bogus", Addr: "definitely-not-a-host.invalid:443"}})
	if err == nil {
		t.Fatal("expected error on bogus host")
	}
	if !strings.Contains(err.Error(), "dns resolution failed") {
		t.Errorf("expected dns resolution failed classification, got %v", err)
	}
	var dnsErr *net.DNSError
	if !errors.As(err, &dnsErr) {
		t.Errorf("expected unwrap to *net.DNSError, got %T", err)
	}
}

func TestProbeStopsOnFirstFailure(t *testing.T) {
	// Good host first — would succeed. Bad host second. Expect second to be reached.
	goodLn, _ := net.Listen("tcp", "127.0.0.1:0")
	defer goodLn.Close()
	go func() {
		for {
			c, err := goodLn.Accept()
			if err != nil {
				return
			}
			_ = c.Close()
		}
	}()
	p := &Prober{PerHostTimeout: 500 * time.Millisecond}
	err := p.Probe(context.Background(), []Host{
		{Name: "good", Addr: goodLn.Addr().String()},
		{Name: "bogus", Addr: "definitely-not-a-host.invalid:443"},
	})
	if err == nil {
		t.Fatal("expected error from second host")
	}
	if !strings.Contains(err.Error(), "bogus") {
		t.Errorf("expected second-host name in error, got %v", err)
	}
}

func TestProbeEmptyHostsIsNoop(t *testing.T) {
	p := &Prober{PerHostTimeout: time.Second}
	if err := p.Probe(context.Background(), nil); err != nil {
		t.Fatalf("empty probe: %v", err)
	}
}
