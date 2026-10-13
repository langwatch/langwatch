package app

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// outboundEnv is outboundsim's own configuration, wherever it runs.
func outboundEnv(st domain.Stack, caCertPath string) []string {
	var port int
	for _, svc := range st.Services {
		if svc.Name == domain.OutboundService {
			port = svc.Port
		}
	}
	env := []string{fmt.Sprintf("OUTBOUNDSIM_ADDR=:%d", port), "OUTBOUNDSIM_STACK=" + st.Slug, "OUTBOUNDSIM_SEED=1"}
	return append(env, outboundTLSEnv(st, caCertPath)...)
}

// outboundTLSEnv mints outboundsim's 127.0.0.1 certificate from the portless CA beside the
// stack's logs and names its https listener, or nothing when there is no CA or no port.
func outboundTLSEnv(st domain.Stack, caCertPath string) []string {
	if st.OutboundTLSPort == 0 || caCertPath == "" {
		return nil
	}
	caCert, certErr := os.ReadFile(caCertPath)
	caKey, keyErr := os.ReadFile(filepath.Join(filepath.Dir(caCertPath), "ca-key.pem"))
	if certErr != nil || keyErr != nil {
		return nil
	}
	cert, key, err := domain.MintLoopbackCertificate(caCert, caKey, time.Now())
	if err != nil {
		return nil
	}
	logDir, _ := domain.StackLogPaths(st.WorktreeDir, st.Slug)
	certPath, keyPath := filepath.Join(logDir, "outboundsim-tls.pem"), filepath.Join(logDir, "outboundsim-tls-key.pem")
	if os.MkdirAll(logDir, 0o700) != nil {
		return nil
	}
	root, err := os.OpenRoot(logDir)
	if err != nil {
		return nil
	}
	defer func() { _ = root.Close() }()
	if root.WriteFile(filepath.Base(certPath), cert, 0o600) != nil || root.WriteFile(filepath.Base(keyPath), key, 0o600) != nil {
		return nil
	}
	return []string{
		fmt.Sprintf("OUTBOUNDSIM_TLS_ADDR=127.0.0.1:%d", st.OutboundTLSPort),
		"OUTBOUNDSIM_TLS_CERT=" + certPath, "OUTBOUNDSIM_TLS_KEY=" + keyPath,
	}
}

// outboundChild is the supervised outboundsim lane. It keeps nothing on disk: its
// console shows the records since it started.
func (o *Orchestrator) outboundChild(st domain.Stack, repoRoot string, base []string) Child {
	logDir, _ := domain.StackLogPaths(st.WorktreeDir, st.Slug)
	return Child{
		Name: domain.OutboundService, Dir: repoRoot, Color: palette[7], LogPath: filepath.Join(logDir, domain.OutboundService+".log"),
		Shell: o.simulatorShell("outbound"),
		Env:   append(append(append([]string{}, base...), domain.LaneEnv(domain.OutboundService)), outboundEnv(st, o.proxy.CACertPath())...),
	}
}
