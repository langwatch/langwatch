package config

import (
	"fmt"
	"os"
	"strings"
)

// Input holds all user-provided configuration, loaded from env vars via struct tags.
type Input struct {
	// Primary — auto-detected from cgroups, or set explicitly. Error if neither.
	// These are parsed manually in Load() to support Kubernetes quantity syntax (e.g. "500m", "4Gi").
	CPU          int    `validate:"gte=1"`
	RAMBytes     int64  `validate:"gte=536870912"` // min 512MB
	Replicated   bool   `env:"CH_REPLICATED"`
	ClusterName  string `env:"CH_CLUSTER" default:"default"`
	Shard        string `env:"CH_SHARD" default:"shard_01"`
	Replica      string `env:"CH_REPLICA"`
	KeeperNodes  string `env:"CH_KEEPER_NODES"`
	KeeperPort   int    `env:"CH_KEEPER_PORT" default:"9181"`
	DataNodes    string `env:"CH_DATA_NODES"`
	DataNodePort int    `env:"CH_DATA_NODE_PORT" default:"9000"`

	// Auth
	Password          string `env:"CLICKHOUSE_PASSWORD"`            // Validate refuses an empty one
	ClusterSecretFile string `env:"CLICKHOUSE_CLUSTER_SECRET_FILE"` // path to mounted cluster secret

	// Opt-in: render the real cluster secret (read from ClusterSecretFile by
	// Load). Off keeps the old from_file attribute ClickHouse ignores, so the
	// cluster runs with no secret; see the README before enabling it.
	ClusterSecretEnabled bool `env:"CLICKHOUSE_CLUSTER_SECRET_ENABLED"`
	ClusterSecret        string

	// Interserver HTTP credentials (replica part fetches); rendered only when
	// the password file is set. InterserverPassword is read from it by Load.
	InterserverUser         string `env:"CLICKHOUSE_INTERSERVER_USER" default:"interserver"`
	InterserverPasswordFile string `env:"CLICKHOUSE_INTERSERVER_PASSWORD_FILE"`
	InterserverPassword     string

	// Optional access.yaml (ADR-184): users, their tiers and logins. The
	// sidecar answers token logins on AccessListen and re-renders the users.
	AccessFile    string `env:"CLICKHOUSE_ACCESS_FILE"`
	AccessListen  string `env:"CLICKHOUSE_ACCESS_LISTEN" default:"127.0.0.1:8124"`
	AccessSidecar string `env:"CLICKHOUSE_ACCESS_SIDECAR" default:"embedded" validate:"oneof=embedded external"`

	// nil means true: default gets access_management and named_collection_control.
	DefaultUserAccessManagement *bool `env:"DEFAULT_USER_ACCESS_MANAGEMENT"`

	// Backups — independent of cold storage, uses same S3-compatible credentials
	BackupEnabled bool `env:"BACKUP_ENABLED"`

	// Object storage (S3-compatible) — validated when ColdEnabled or BackupEnabled
	ColdEnabled               bool   `env:"COLD_STORAGE_ENABLED"`
	S3Endpoint                string `env:"S3_ENDPOINT"`
	S3AccessKey               string `env:"S3_ACCESS_KEY"`
	S3SecretKey               string `env:"S3_SECRET_KEY"`
	S3Bucket                  string `env:"S3_BUCKET" default:"clickhouse"`
	S3Region                  string `env:"S3_REGION" default:"us-east-1"`
	UseEnvironmentCredentials bool   `env:"USE_ENVIRONMENT_CREDENTIALS" default:"true"`
	UseInsecureIMDS           bool   `env:"USE_INSECURE_IMDS_REQUEST"`
	DRS3Endpoint              string `env:"DR_S3_ENDPOINT"`
	TieredMoveFactor          string `env:"TIERED_MOVE_FACTOR" default:"0.9"`
	LocalDiskKeepFreeBytes    int64  `env:"LOCAL_DISK_KEEP_FREE_BYTES" default:"1073741824"`
	MaxDataPartSizeBytes      int64  `env:"MAX_DATA_PART_SIZE_BYTES"`

	// Logging
	LogLevel         string `env:"LOG_LEVEL" default:"warning" validate:"oneof=trace debug information warning error"`
	LogFormat        string `env:"LOG_FORMAT" default:"json"   validate:"oneof=json plain"`
	LogToFile        bool   `env:"LOG_TO_FILE" default:"true"` // false: console only, no server log files
	SystemLogTTLDays int    `env:"SYSTEM_LOG_TTL_DAYS" default:"30"`

	// System logs — each log has enable + TTL + optional flush settings
	EnableQueryLog        bool   `env:"ENABLE_QUERY_LOG" default:"true"`
	QueryLogTTLDays       int    `env:"QUERY_LOG_TTL_DAYS" default:"7"`
	QueryLogFlushMs       int    `env:"QUERY_LOG_FLUSH_INTERVAL_MS" default:"7500"`
	EnablePartLog         bool   `env:"ENABLE_PART_LOG" default:"true"`
	PartLogTTLDays        int    `env:"PART_LOG_TTL_DAYS" default:"14"`
	EnableMetricLog       bool   `env:"ENABLE_METRIC_LOG"`
	MetricLogTTLDays      int    `env:"METRIC_LOG_TTL_DAYS" default:"7"`
	MetricLogFlushMs      int    `env:"METRIC_LOG_FLUSH_INTERVAL_MS" default:"30000"`
	MetricLogCollectMs    int    `env:"METRIC_LOG_COLLECT_INTERVAL_MS" default:"10000"`
	EnableTraceLog        bool   `env:"ENABLE_TRACE_LOG"`
	TraceLogTTLDays       int    `env:"TRACE_LOG_TTL_DAYS" default:"3"`
	EnableTextLog         bool   `env:"ENABLE_TEXT_LOG"`
	TextLogTTLDays        int    `env:"TEXT_LOG_TTL_DAYS" default:"3"`
	TextLogLevel          string `env:"TEXT_LOG_LEVEL" default:"warning"`
	EnableSessionLog      bool   `env:"ENABLE_SESSION_LOG"`
	SessionLogTTLDays     int    `env:"SESSION_LOG_TTL_DAYS" default:"30"`
	EnableAsyncMetricLog  bool   `env:"ENABLE_ASYNC_METRIC_LOG"`
	AsyncMetricLogTTLDays int    `env:"ASYNC_METRIC_LOG_TTL_DAYS" default:"7"`
	EnableOtelSpanLog     bool   `env:"ENABLE_OTEL_SPAN_LOG"`
	OtelSpanLogTTLDays    int    `env:"OTEL_SPAN_LOG_TTL_DAYS" default:"7"`
	EnableProfileLog      bool   `env:"ENABLE_PROCESSORS_PROFILE_LOG"`
	EnableBlobLog         bool   `env:"ENABLE_BLOB_STORAGE_LOG"`
	EnablePrometheus      bool   `env:"ENABLE_PROMETHEUS_METRICS"`

	// Execution-time cap of the inspect and read tiers' profiles (ADR-184).
	ReadTierMaxExecutionTime int `env:"READ_TIER_MAX_EXECUTION_TIME" default:"300" validate:"gte=1"`

	// Query limits (0 = unlimited)
	MaxExecutionTime    int    `env:"MAX_EXECUTION_TIME"`
	MaxRowsToRead       int64  `env:"MAX_ROWS_TO_READ"`
	MaxBytesToRead      int64  `env:"MAX_BYTES_TO_READ"`
	MaxResultRows       int64  `env:"MAX_RESULT_ROWS"`
	MaxResultBytes      int64  `env:"MAX_RESULT_BYTES"`
	MaxRowsToGroupBy    int64  `env:"MAX_ROWS_TO_GROUP_BY"`
	GroupByOverflowMode string `env:"GROUP_BY_OVERFLOW_MODE" default:"throw" validate:"oneof=throw break any"`
	MaxTempDataOnDisk   int64  `env:"MAX_TEMPORARY_DATA_ON_DISK_SIZE"`

	// Network
	MaxConnections      int `env:"MAX_CONNECTIONS" default:"4096"`
	KeepAliveTimeout    int `env:"KEEP_ALIVE_TIMEOUT" default:"10"`
	HTTPReceiveTimeout  int `env:"HTTP_RECEIVE_TIMEOUT" default:"1800"`
	HTTPSendTimeout     int `env:"HTTP_SEND_TIMEOUT" default:"1800"`
	TCPKeepAliveTimeout int `env:"TCP_KEEP_ALIVE_TIMEOUT" default:"10"`
	ListenBacklog       int `env:"LISTEN_BACKLOG" default:"4096"`

	// Backup connection
	ClickHouseHost string `env:"CLICKHOUSE_HOST" default:"localhost"`
	ClickHousePort int    `env:"CLICKHOUSE_PORT" default:"9000"`
	ClickHouseUser string `env:"CLICKHOUSE_USER" default:"default"`
}

// Load reads configuration from env vars + cgroup auto-detection.
func Load() (*Input, error) {
	i := &Input{}

	// Load all tagged fields from env
	if err := loadEnv(i); err != nil {
		return nil, err
	}

	// CPU: parse human-readable env or auto-detect from cgroups
	if raw := os.Getenv("CH_CPU"); raw != "" {
		cpu, err := ParseCPU(raw)
		if err != nil {
			return nil, fmt.Errorf("CH_CPU: %w", err)
		}
		i.CPU = cpu
	} else {
		cpu, err := DetectCPU()
		if err != nil {
			return nil, fmt.Errorf("CH_CPU not set and auto-detect failed: %w", err)
		}
		i.CPU = cpu
	}

	// RAM: parse human-readable env or auto-detect from cgroups
	if raw := os.Getenv("CH_RAM"); raw != "" {
		ram, err := ParseHumanBytes(raw)
		if err != nil {
			return nil, fmt.Errorf("CH_RAM: %w", err)
		}
		i.RAMBytes = ram
	} else {
		ram, err := DetectRAM()
		if err != nil {
			return nil, fmt.Errorf("CH_RAM not set and auto-detect failed: %w", err)
		}
		i.RAMBytes = ram
	}

	// Password from file overrides env
	if pwFile := os.Getenv("CLICKHOUSE_PASSWORD_FILE"); pwFile != "" {
		data, err := os.ReadFile(pwFile)
		if err != nil {
			return nil, fmt.Errorf("CLICKHOUSE_PASSWORD_FILE: %w", err)
		}
		i.Password = strings.TrimSpace(string(data))
	}

	for _, f := range []struct {
		env, path string
		read      bool
		dst       *string
	}{
		{"CLICKHOUSE_CLUSTER_SECRET_FILE", i.ClusterSecretFile, i.ClusterSecretEnabled, &i.ClusterSecret},
		{"CLICKHOUSE_INTERSERVER_PASSWORD_FILE", i.InterserverPasswordFile, true, &i.InterserverPassword},
	} {
		if f.path == "" || !f.read {
			continue
		}
		secret, err := readSecretFile(f.path)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", f.env, err)
		}
		*f.dst = secret
	}

	return i, nil
}

// GrantsDefaultAccessManagement reports whether ch-config grants the default
// user access_management and named_collection_control (unset means yes).
func (i *Input) GrantsDefaultAccessManagement() bool {
	return i.DefaultUserAccessManagement == nil || *i.DefaultUserAccessManagement
}

// readSecretFile returns the trimmed content of a mounted secret, refusing an
// empty one: an empty credential would render as no credential at all.
func readSecretFile(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	secret := strings.TrimSpace(string(data))
	if secret == "" {
		return "", fmt.Errorf("%s is empty", path)
	}
	return secret, nil
}
