package storage

import (
	"fmt"
	"strings"

	"github.com/langwatch/langwatch/clickhouse-serverless/internal/config"
	"gopkg.in/yaml.v3"
)

// --- Top-level config structure ---

type storageConfig struct {
	StorageConfiguration *storageConfiguration `yaml:"storage_configuration,omitempty"`
	Backups              *backupsSection       `yaml:"backups,omitempty"`
}

type storageConfiguration struct {
	Disks    map[string]any    `yaml:"disks"`
	Policies map[string]policy `yaml:"policies"`
}

type backupsSection struct {
	AllowedDisk []string `yaml:"allowed_disk"`
}

// --- Disk types ---

type localDisk struct {
	Path               string `yaml:"path"`
	KeepFreeSpaceBytes int64  `yaml:"keep_free_space_bytes"`
}

type s3Disk struct {
	Type                      string `yaml:"type"`
	Endpoint                  string `yaml:"endpoint"`
	Region                    string `yaml:"region,omitempty"`
	AccessKeyID               string `yaml:"access_key_id,omitempty"`
	SecretAccessKey            string `yaml:"secret_access_key,omitempty"`
	UseEnvironmentCredentials bool   `yaml:"use_environment_credentials"`
	UseInsecureIMDSRequest    bool   `yaml:"use_insecure_imds_request"`
	MetadataPath              string `yaml:"metadata_path,omitempty"`
	CacheEnabled              bool   `yaml:"cache_enabled,omitempty"`
	CachePath                 string `yaml:"cache_path,omitempty"`
	MaxCacheSize              int64  `yaml:"max_cache_size,omitempty"`
	SkipAccessCheck           bool   `yaml:"skip_access_check"`
}

type s3PlainDisk struct {
	Type            string `yaml:"type"`
	Endpoint        string `yaml:"endpoint"`
	AccessKeyID     string `yaml:"access_key_id,omitempty"`
	SecretAccessKey  string `yaml:"secret_access_key,omitempty"`
	SkipAccessCheck bool   `yaml:"skip_access_check"`
}

// --- Policy types ---

type policy struct {
	Volumes    map[string]volume `yaml:"volumes"`
	MoveFactor string            `yaml:"move_factor"`
}

type volume struct {
	Disk                 string `yaml:"disk"`
	MaxDataPartSizeBytes int64  `yaml:"max_data_part_size_bytes,omitempty"`
}

// Render generates the storage configuration YAML for ClickHouse.
// It produces the object S3 disk + tiered policy when ColdEnabled,
// the backups s3_plain disk when BackupEnabled, or both.
func Render(input *config.Input, computed *config.Computed) ([]byte, error) {
	endpoint := buildS3Endpoint(input.S3Endpoint, input.S3Bucket, input.S3Region)

	cfg := storageConfig{}

	disks := map[string]any{}
	var allowedDisks []string

	// Cold storage: object disk + tiered storage policy
	if input.ColdEnabled {
		cacheSize := computed.CacheMaxSize
		if cacheSize <= 0 {
			cacheSize = 1 << 30 // 1GB fallback
		}

		objectDisk := s3Disk{
			Type:                      "s3",
			Endpoint:                  endpoint,
			Region:                    input.S3Region,
			UseEnvironmentCredentials: input.UseEnvironmentCredentials,
			UseInsecureIMDSRequest:    input.UseInsecureIMDS,
			MetadataPath:              "/var/lib/clickhouse/disks/object/",
			CacheEnabled:              true,
			CachePath:                 "/var/lib/clickhouse/disks/object/cache/",
			MaxCacheSize:              cacheSize,
			SkipAccessCheck:           true,
		}

		if input.S3AccessKey != "" && input.S3SecretKey != "" {
			objectDisk.AccessKeyID = input.S3AccessKey
			objectDisk.SecretAccessKey = input.S3SecretKey
		}

		disks["local"] = localDisk{
			Path:               "/var/lib/clickhouse/data/",
			KeepFreeSpaceBytes: input.LocalDiskKeepFreeBytes,
		}
		disks["object"] = objectDisk
		allowedDisks = append(allowedDisks, "object")

		hotVolume := volume{Disk: "local"}
		if input.MaxDataPartSizeBytes > 0 {
			hotVolume.MaxDataPartSizeBytes = input.MaxDataPartSizeBytes
		}

		cfg.StorageConfiguration = &storageConfiguration{
			Disks: disks,
			Policies: map[string]policy{
				"local_primary": {
					Volumes: map[string]volume{
						"hot":  hotVolume,
						"cold": {Disk: "object"},
					},
					MoveFactor: input.TieredMoveFactor,
				},
			},
		}
	}

	// Backups: s3_plain disk
	if input.BackupEnabled {
		backupsDisk := s3PlainDisk{
			Type:            "s3_plain",
			Endpoint:        ensureTrailingSlash(endpoint) + "clickhouse-backup/",
			SkipAccessCheck: true,
		}
		if input.S3AccessKey != "" && input.S3SecretKey != "" {
			backupsDisk.AccessKeyID = input.S3AccessKey
			backupsDisk.SecretAccessKey = input.S3SecretKey
		}

		// If cold is not enabled, we need to initialize disks in the storage configuration
		if cfg.StorageConfiguration == nil {
			cfg.StorageConfiguration = &storageConfiguration{
				Disks:    map[string]any{},
				Policies: map[string]policy{},
			}
		}
		cfg.StorageConfiguration.Disks["backups"] = backupsDisk
		allowedDisks = append(allowedDisks, "backups")

		if input.DRS3Endpoint != "" {
			drDisk := s3PlainDisk{
				Type:            "s3_plain",
				Endpoint:        ensureTrailingSlash(input.DRS3Endpoint),
				SkipAccessCheck: true,
			}
			if input.S3AccessKey != "" && input.S3SecretKey != "" {
				drDisk.AccessKeyID = input.S3AccessKey
				drDisk.SecretAccessKey = input.S3SecretKey
			}
			cfg.StorageConfiguration.Disks["backups_dr"] = drDisk
			allowedDisks = append(allowedDisks, "backups_dr")
		}
	}

	if len(allowedDisks) > 0 {
		cfg.Backups = &backupsSection{
			AllowedDisk: allowedDisks,
		}
	}

	return yaml.Marshal(cfg)
}

// buildS3Endpoint constructs the S3 endpoint URL.
// If a custom endpoint is provided, it's used as-is (should be the full path including bucket).
// Otherwise it builds the standard AWS S3 URL from region and bucket.
func buildS3Endpoint(customEndpoint, bucket, region string) string {
	if customEndpoint != "" {
		return ensureTrailingSlash(customEndpoint)
	}
	return fmt.Sprintf("https://s3.%s.amazonaws.com/%s/", region, bucket)
}

func ensureTrailingSlash(s string) string {
	if strings.HasSuffix(s, "/") {
		return s
	}
	return s + "/"
}
