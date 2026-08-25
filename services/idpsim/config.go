package idpsim

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// Config is idpsim's environment-derived configuration.
type Config struct {
	// Addr is the HTTP listen address (SERVER_ADDR, default :5565).
	Addr string
	// BaseURL is the externally reachable base for issuer/metadata URLs
	// (IDPSIM_BASE_URL). Under haven this is the routed hostname; standalone it
	// defaults to http://localhost:<port>.
	BaseURL string
	// Tenants is how many independent IdP tenants to serve (IDPSIM_TENANTS,
	// default 3, capped so a fat-fingered range cannot stall boot on key
	// generation).
	Tenants int
	// DNSAddr is the UDP listen address for the verification DNS server
	// (IDPSIM_DNS_ADDR, default :15353; "off" disables it).
	DNSAddr string
}

// maxTenants bounds the range: each tenant costs an RSA keypair at boot.
const maxTenants = 100

// LoadConfig reads idpsim's configuration from the environment.
func LoadConfig() (Config, error) {
	cfg := Config{
		Addr:    envOr("SERVER_ADDR", ":5565"),
		Tenants: 3,
		DNSAddr: envOr("IDPSIM_DNS_ADDR", ":15353"),
	}
	if raw := os.Getenv("IDPSIM_TENANTS"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > maxTenants {
			return Config{}, fmt.Errorf("IDPSIM_TENANTS must be an integer between 1 and %d, got %q", maxTenants, raw)
		}
		cfg.Tenants = n
	}
	cfg.BaseURL = strings.TrimSuffix(envOr("IDPSIM_BASE_URL", defaultBaseURL(cfg.Addr)), "/")
	if strings.EqualFold(cfg.DNSAddr, "off") {
		cfg.DNSAddr = ""
	}
	return cfg, nil
}

func defaultBaseURL(addr string) string {
	port := strings.TrimPrefix(addr[strings.LastIndex(addr, ":")+1:], ":")
	return "http://localhost:" + port
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
