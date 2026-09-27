package apidiff

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"os"
	"time"
)

// judgePath is the one route the Instant Evals judge client calls (both
// layouts resolve it against JEV_BASE_URL's origin).
const judgePath = "/v1/systemone"

// judgeStub answers the Instant Evals judge over TLS, since both sides refuse
// a judge address that is not https. The instances trust it through
// NODE_EXTRA_CA_CERTS, a bundle of the stub's own authority plus whatever
// bundle the developer's environment already named.
type judgeStub struct {
	server *http.Server
	url    string
	caPath string
}

func startJudgeStub() (*judgeStub, error) {
	authority, leaf, err := loopbackCertificates()
	if err != nil {
		return nil, fmt.Errorf("judge stub: %w", err)
	}
	caPath, err := writeCABundle(authority)
	if err != nil {
		return nil, fmt.Errorf("judge stub: %w", err)
	}
	var listenConfig net.ListenConfig
	listener, err := listenConfig.Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		_ = os.Remove(caPath)
		return nil, fmt.Errorf("judge stub: %w", err)
	}
	tlsListener := tls.NewListener(listener, &tls.Config{Certificates: []tls.Certificate{leaf}, MinVersion: tls.VersionTLS12})
	stub := &judgeStub{
		server: &http.Server{Handler: http.HandlerFunc(judgeStubHandler), ReadHeaderTimeout: 10 * time.Second},
		url:    "https://" + listener.Addr().String(),
		caPath: caPath,
	}
	go func() {
		if serveErr := stub.server.Serve(tlsListener); serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
			return
		}
	}()
	return stub, nil
}

func (stub *judgeStub) Close() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = stub.server.Shutdown(ctx)
	_ = os.Remove(stub.caPath)
}

// judgeStubHandler answers every boolean question with a confident yes, in
// the judge's published shape. Other question kinds get no answer, which
// both sides read as an unanswered cell.
func judgeStubHandler(writer http.ResponseWriter, request *http.Request) {
	if request.URL.Path != judgePath || request.Header.Get("Authorization") != "Bearer "+throwawayJudgeKey {
		_, _ = io.Copy(io.Discard, request.Body)
		writer.WriteHeader(http.StatusUnauthorized)
		return
	}
	var asked struct {
		Questions map[string]struct {
			Type string `json:"type"`
		} `json:"questions"`
	}
	if err := json.NewDecoder(request.Body).Decode(&asked); err != nil {
		writer.WriteHeader(http.StatusBadRequest)
		return
	}
	answers := make(map[string]any, len(asked.Questions))
	for id, question := range asked.Questions {
		if question.Type == "noul" {
			answers[id] = map[string]any{"type": "noul", "noul": 0.9}
		}
	}
	writer.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(writer).Encode(map[string]any{
		"model": "jev-latest", "answers": answers,
		"usage": map[string]any{"input_tokens": 10, "output_tokens": 1},
	})
}

// loopbackCertificates mints a throwaway authority and a loopback server
// certificate it signs; the authority is what the instances are told to trust.
func loopbackCertificates() (authorityPEM []byte, leaf tls.Certificate, err error) {
	authorityKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, tls.Certificate{}, err
	}
	now := time.Now()
	authorityTemplate := &x509.Certificate{
		SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "apidiff throwaway authority"},
		NotBefore: now.Add(-time.Hour), NotAfter: now.Add(24 * time.Hour),
		IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature,
	}
	authorityDER, err := x509.CreateCertificate(rand.Reader, authorityTemplate, authorityTemplate, &authorityKey.PublicKey, authorityKey)
	if err != nil {
		return nil, tls.Certificate{}, err
	}
	leafKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, tls.Certificate{}, err
	}
	leafTemplate := &x509.Certificate{
		SerialNumber: big.NewInt(2), Subject: pkix.Name{CommonName: "127.0.0.1"},
		NotBefore: now.Add(-time.Hour), NotAfter: now.Add(24 * time.Hour),
		IPAddresses: []net.IP{net.IPv4(127, 0, 0, 1)}, DNSNames: []string{"localhost"},
		KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	leafDER, err := x509.CreateCertificate(rand.Reader, leafTemplate, authorityTemplate, &leafKey.PublicKey, authorityKey)
	if err != nil {
		return nil, tls.Certificate{}, err
	}
	authorityPEM = pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: authorityDER})
	return authorityPEM, tls.Certificate{Certificate: [][]byte{leafDER}, PrivateKey: leafKey}, nil
}

// writeCABundle writes the stub authority, followed by the developer's own
// bundle when their environment names one, since NODE_EXTRA_CA_CERTS takes a
// single file and the instance must not lose what that file trusted.
func writeCABundle(authorityPEM []byte) (string, error) {
	bundle := append([]byte(nil), authorityPEM...)
	if inherited := inheritedCABundle(); inherited != "" {
		if existing, err := os.ReadFile(inherited); err == nil {
			bundle = append(bundle, existing...)
		}
	}
	file, err := os.CreateTemp("", "apidiff-judge-ca-*.pem")
	if err != nil {
		return "", err
	}
	defer file.Close()
	if _, err := file.Write(bundle); err != nil {
		_ = os.Remove(file.Name())
		return "", err
	}
	return file.Name(), nil
}

// inheritedCABundle is the bundle the developer's environment names, if any.
func inheritedCABundle() string {
	return os.Getenv("NODE_EXTRA_CA_CERTS")
}
