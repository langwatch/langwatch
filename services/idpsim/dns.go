package idpsim

import (
	"context"
	"fmt"
	"net"
	"strings"

	"golang.org/x/net/dns/dnsmessage"
)

// dnsServer answers TXT queries from the verification store — the DNS half of
// domain verification. Point a resolver (or a verifier's resolver override) at
// it and a configured domain proves ownership; anything else gets NXDOMAIN.
// It also answers A queries for configured domains with 127.0.0.1, so a
// verifier that resolves before it fetches keeps working.
type dnsServer struct {
	store *verificationStore
	conn  net.PacketConn
	// observe, when set, is told about every TXT question, so the tenant that
	// owns the domain can show that a verifier really did come and ask.
	observe func(domain string, found bool)
}

// startDNS binds the UDP listener and serves until ctx ends. addr="" disables
// the server. The returned address is the bound one, so tests can bind :0.
func startDNS(ctx context.Context, addr string, store *verificationStore, observe func(domain string, found bool)) (*dnsServer, error) {
	if addr == "" {
		return nil, nil
	}
	var lc net.ListenConfig
	conn, err := lc.ListenPacket(ctx, "udp", addr)
	if err != nil {
		return nil, fmt.Errorf("binding verification DNS listener on %s: %w", addr, err)
	}
	s := &dnsServer{store: store, conn: conn, observe: observe}
	go func() {
		<-ctx.Done()
		_ = conn.Close()
	}()
	go s.serve()
	return s, nil
}

// Addr is the bound UDP address.
func (s *dnsServer) Addr() string { return s.conn.LocalAddr().String() }

func (s *dnsServer) serve() {
	buf := make([]byte, 4096)
	for {
		n, from, err := s.conn.ReadFrom(buf)
		if err != nil {
			return // closed by shutdown
		}
		if reply, ok := s.answer(buf[:n]); ok {
			_, _ = s.conn.WriteTo(reply, from)
		}
	}
}

// answer builds one reply for one query packet.
func (s *dnsServer) answer(packet []byte) ([]byte, bool) {
	var parser dnsmessage.Parser
	header, err := parser.Start(packet)
	if err != nil {
		return nil, false
	}
	question, err := parser.Question()
	if err != nil {
		return nil, false
	}
	domain := strings.TrimSuffix(question.Name.String(), ".")

	reply := dnsmessage.Message{
		Header: dnsmessage.Header{
			ID:            header.ID,
			Response:      true,
			Authoritative: true,
			RCode:         dnsmessage.RCodeSuccess,
		},
		Questions: []dnsmessage.Question{question},
	}
	switch question.Type {
	case dnsmessage.TypeTXT:
		values, ok := s.store.TXT(domain)
		if s.observe != nil {
			s.observe(domain, ok)
		}
		if !ok {
			reply.RCode = dnsmessage.RCodeNameError
			break
		}
		for _, v := range values {
			reply.Answers = append(reply.Answers, dnsmessage.Resource{
				Header: dnsmessage.ResourceHeader{
					Name: question.Name, Type: dnsmessage.TypeTXT,
					Class: dnsmessage.ClassINET, TTL: 30,
				},
				Body: &dnsmessage.TXTResource{TXT: []string{v}},
			})
		}
	case dnsmessage.TypeA:
		if _, ok := s.store.TXT(domain); !ok {
			if _, ok := s.store.Token(domain); !ok {
				reply.RCode = dnsmessage.RCodeNameError
				break
			}
		}
		reply.Answers = append(reply.Answers, dnsmessage.Resource{
			Header: dnsmessage.ResourceHeader{
				Name: question.Name, Type: dnsmessage.TypeA,
				Class: dnsmessage.ClassINET, TTL: 30,
			},
			Body: &dnsmessage.AResource{A: [4]byte{127, 0, 0, 1}},
		})
	default:
		reply.RCode = dnsmessage.RCodeNameError
	}
	packed, err := reply.Pack()
	if err != nil {
		return nil, false
	}
	return packed, true
}
