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

// dnsConfig is what the verification DNS listener needs to run.
type dnsConfig struct {
	// Addr is the UDP address to bind; "" disables the server entirely.
	Addr  string
	Store *verificationStore
	// Observe, when set, is told about every TXT question.
	Observe func(domain string, found bool)
}

// startDNS binds the UDP listener and serves until ctx ends. The returned
// address is the bound one, so a caller (or a test) can pass :0 and still
// learn where it landed.
func startDNS(ctx context.Context, cfg dnsConfig) (*dnsServer, error) {
	if cfg.Addr == "" {
		return nil, nil
	}
	var lc net.ListenConfig
	conn, err := lc.ListenPacket(ctx, "udp", cfg.Addr)
	if err != nil {
		return nil, fmt.Errorf("binding verification DNS listener on %s: %w", cfg.Addr, err)
	}
	s := &dnsServer{store: cfg.Store, conn: conn, observe: cfg.Observe}
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
		reply.Answers, reply.RCode = s.answerTXT(question, domain)
	case dnsmessage.TypeA:
		reply.Answers, reply.RCode = s.answerA(question, domain)
	default:
		reply.RCode = dnsmessage.RCodeNameError
	}
	packed, err := reply.Pack()
	if err != nil {
		return nil, false
	}
	return packed, true
}

// answerTXT serves the domain's verification records, and tells the observer
// whether there were any — that is the signal that a verifier actually came
// and looked.
func (s *dnsServer) answerTXT(question dnsmessage.Question, domain string) ([]dnsmessage.Resource, dnsmessage.RCode) {
	values, ok := s.store.TXT(domain)
	if s.observe != nil {
		s.observe(domain, ok)
	}
	if !ok {
		return nil, dnsmessage.RCodeNameError
	}
	answers := make([]dnsmessage.Resource, 0, len(values))
	for _, v := range values {
		answers = append(answers, dnsmessage.Resource{
			Header: recordHeader(question.Name, dnsmessage.TypeTXT),
			Body:   &dnsmessage.TXTResource{TXT: []string{v}},
		})
	}
	return answers, dnsmessage.RCodeSuccess
}

// answerA points a configured domain at loopback, so a verifier that resolves
// before it fetches keeps working.
func (s *dnsServer) answerA(question dnsmessage.Question, domain string) ([]dnsmessage.Resource, dnsmessage.RCode) {
	if !s.known(domain) {
		return nil, dnsmessage.RCodeNameError
	}
	return []dnsmessage.Resource{{
		Header: recordHeader(question.Name, dnsmessage.TypeA),
		Body:   &dnsmessage.AResource{A: [4]byte{127, 0, 0, 1}},
	}}, dnsmessage.RCodeSuccess
}

// known reports whether either verification channel is configured for a domain.
func (s *dnsServer) known(domain string) bool {
	if _, ok := s.store.TXT(domain); ok {
		return true
	}
	_, ok := s.store.Token(domain)
	return ok
}

func recordHeader(name dnsmessage.Name, recordType dnsmessage.Type) dnsmessage.ResourceHeader {
	return dnsmessage.ResourceHeader{
		Name: name, Type: recordType, Class: dnsmessage.ClassINET, TTL: 30,
	}
}
