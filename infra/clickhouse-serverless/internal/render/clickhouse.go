package render

import (
	"crypto/rand"
	"crypto/sha256"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/config"
)

// renderDefaultPassword writes default-password.yaml with the SHA256-hashed
// password. In dynamic-only mode default is locked instead: the hash of 32
// random bytes nobody keeps, and an empty network list, so no address may
// log in as default whatever it presents.
func renderDefaultPassword(input *config.Input, usersD string) error {
	if input.DynamicOnly {
		secret := make([]byte, 32)
		if _, err := rand.Read(secret); err != nil {
			return err
		}
		h := sha256.Sum256(secret)
		return writeYAML(filepath.Join(usersD, "default-password.yaml"), map[string]any{
			"users": map[string]any{
				"default": map[string]any{
					"password":            map[string]string{"@remove": "1"},
					"password_sha256_hex": fmt.Sprintf("%x", h),
					"networks":            map[string]string{"@replace": "replace"},
				},
			},
		})
	}
	h := sha256.Sum256([]byte(input.Password))
	return writeYAML(filepath.Join(usersD, "default-password.yaml"), map[string]any{
		"users": map[string]any{
			"default": map[string]any{
				"password":            map[string]string{"@remove": "1"},
				"password_sha256_hex": fmt.Sprintf("%x", h),
			},
		},
	})
}

// renderKeeper writes keeper.yaml with zookeeper client config, macros, and remote_servers.
// Used in replicated mode so the Go binary is self-sufficient without Helm.
func renderKeeper(input *config.Input, configD string) error {
	keeperNodes := parseCSV(input.KeeperNodes)
	dataNodes := parseCSV(input.DataNodes)

	// ZooKeeper client nodes
	znodes := make([]map[string]any, len(keeperNodes))
	for i, host := range keeperNodes {
		znodes[i] = map[string]any{"host": host, "port": input.KeeperPort}
	}

	// Remote server replicas
	replicas := make([]map[string]any, len(dataNodes))
	for i, host := range dataNodes {
		replicas[i] = map[string]any{"host": host, "port": input.DataNodePort}
	}

	cluster := map[string]any{
		"shard": map[string]any{
			"internal_replication": true,
			"replica":              replicas,
		},
	}
	// ClickHouse substitutes from_env and from_zk, not from_file, so only the
	// value itself sets a secret. Without the opt-in, keep the earlier
	// from_file attribute: no secret, matching pods that have not rolled yet.
	if input.ClusterSecretEnabled {
		cluster["secret"] = input.ClusterSecret
	} else {
		cluster["secret"] = map[string]string{"@from_file": input.ClusterSecretFile}
	}

	return writeYAML(filepath.Join(configD, "keeper.yaml"), map[string]any{
		"zookeeper": map[string]any{
			"node":                 znodes,
			"session_timeout_ms":   30000,
			"operation_timeout_ms": 10000,
		},
		"macros": map[string]string{
			"shard":   input.Shard,
			"replica": input.Replica,
			"cluster": input.ClusterName,
		},
		"remote_servers": map[string]any{
			input.ClusterName: cluster,
		},
	})
}

// renderInterserver writes interserver.yaml: the credentials replicas present
// to each other's interserver HTTP endpoint when fetching parts.
func renderInterserver(input *config.Input, configD string) error {
	return writeYAML(filepath.Join(configD, "interserver.yaml"), map[string]any{
		"interserver_http_credentials": map[string]string{
			"user":     input.InterserverUser,
			"password": input.InterserverPassword,
		},
	})
}

func parseCSV(s string) []string {
	var out []string
	for _, v := range strings.Split(s, ",") {
		v = strings.TrimSpace(v)
		if v != "" {
			out = append(out, v)
		}
	}
	return out
}

// renderLogging writes logging.yaml with log level and format settings.
// Without LOG_TO_FILE the image's file and error-file loggers are removed, so
// the server logs to the console only.
func renderLogging(input *config.Input, configD string) error {
	logger := map[string]any{
		"level":      input.LogLevel,
		"console":    true,
		"formatting": map[string]string{"type": input.LogFormat},
	}
	if !input.LogToFile {
		logger["log"] = map[string]string{"@remove": "1"}
		logger["errorlog"] = map[string]string{"@remove": "1"}
	}
	return writeYAML(filepath.Join(configD, "logging.yaml"), map[string]any{
		"logger": logger,
	})
}

// renderNetwork writes network.yaml with connection and timeout settings.
func renderNetwork(c *config.Computed, configD string) error {
	return writeYAML(filepath.Join(configD, "network.yaml"), map[string]any{
		"listen_host":        "0.0.0.0",
		"max_connections":    c.MaxConnections,
		"keep_alive_timeout": c.KeepAliveTimeout,
		"listen_backlog":     c.ListenBacklog,
	})
}

// renderPrometheus writes prometheus.yaml with metrics endpoint configuration.
func renderPrometheus(configD string) error {
	return writeYAML(filepath.Join(configD, "prometheus.yaml"), map[string]any{
		"prometheus": map[string]any{
			"endpoint":             "/metrics",
			"port":                 9363,
			"metrics":              true,
			"events":               true,
			"asynchronous_metrics": true,
			"errors":               true,
		},
	})
}
