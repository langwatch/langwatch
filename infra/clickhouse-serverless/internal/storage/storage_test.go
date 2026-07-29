package storage

import (
	"strings"
	"testing"

	"github.com/langwatch/langwatch/clickhouse-serverless/internal/config"
)

func defaultInput() *config.Input {
	return &config.Input{
		S3Endpoint:                "",
		S3AccessKey:               "",
		S3SecretKey:               "",
		S3Bucket:                  "mybucket",
		S3Region:                  "us-east-1",
		UseEnvironmentCredentials: true,
		UseInsecureIMDS:           false,
		DRS3Endpoint:              "",
		TieredMoveFactor:          "0.9",
		LocalDiskKeepFreeBytes:    1 << 30,
		MaxDataPartSizeBytes:      0,
		ColdEnabled:               true,
		BackupEnabled:             false,
	}
}

func defaultComputed() *config.Computed {
	return &config.Computed{
		CacheMaxSize: 1 << 30, // 1GB default for tests
	}
}

func TestRender_ColdOnlyWithStaticCredentials(t *testing.T) {
	input := defaultInput()
	input.S3AccessKey = "AKIAIOSFODNN7EXAMPLE"
	input.S3SecretKey = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"

	out, err := Render(input, defaultComputed())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	yaml := string(out)

	// Check object disk has S3 type and endpoint
	assertContains(t, yaml, "type: s3")
	assertContains(t, yaml, "endpoint: https://s3.us-east-1.amazonaws.com/mybucket/")
	assertContains(t, yaml, "region: us-east-1")

	// Check static credentials are present
	assertContains(t, yaml, "access_key_id: AKIAIOSFODNN7EXAMPLE")
	assertContains(t, yaml, "secret_access_key: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY")

	// Check environment credentials still set
	assertContains(t, yaml, "use_environment_credentials: true")

	// Check local disk
	assertContains(t, yaml, "path: /var/lib/clickhouse/data/")
	assertContains(t, yaml, "keep_free_space_bytes: 1073741824")

	// Check cache settings
	assertContains(t, yaml, "cache_enabled: true")
	assertContains(t, yaml, "cache_path: /var/lib/clickhouse/disks/object/cache/")
	assertContains(t, yaml, "max_cache_size: 1073741824")

	// Check policy
	assertContains(t, yaml, "local_primary:")
	assertContains(t, yaml, "move_factor: \"0.9\"")

	// Check backups allowed_disk includes object
	assertContains(t, yaml, "allowed_disk:")
	assertContains(t, yaml, "- object")

	// No backup disk when BackupEnabled=false
	assertNotContains(t, yaml, "s3_plain")
}

func TestRender_ColdOnlyWithIRSA(t *testing.T) {
	input := defaultInput()
	// No static credentials -> IRSA mode

	out, err := Render(input, defaultComputed())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	yaml := string(out)

	// Check S3 type
	assertContains(t, yaml, "type: s3")
	assertContains(t, yaml, "endpoint: https://s3.us-east-1.amazonaws.com/mybucket/")

	// No static credentials
	assertNotContains(t, yaml, "access_key_id:")
	assertNotContains(t, yaml, "secret_access_key:")

	// Environment credentials should be true
	assertContains(t, yaml, "use_environment_credentials: true")
	assertContains(t, yaml, "use_insecure_imds_request: false")
}

func TestRender_BackupOnly(t *testing.T) {
	input := defaultInput()
	input.ColdEnabled = false
	input.BackupEnabled = true
	input.S3AccessKey = "AKIAEXAMPLE"
	input.S3SecretKey = "secretexample"

	out, err := Render(input, defaultComputed())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	yaml := string(out)

	// Should have backups disk
	assertContains(t, yaml, "type: s3_plain")
	assertContains(t, yaml, "clickhouse-backup/")
	assertContains(t, yaml, "access_key_id: AKIAEXAMPLE")

	// Should have allowed_disk with backups
	assertContains(t, yaml, "allowed_disk:")
	assertContains(t, yaml, "- backups")

	// Should NOT have cold storage (no object disk, no policy)
	assertNotContains(t, yaml, "type: s3\n")
	assertNotContains(t, yaml, "local_primary:")
	assertNotContains(t, yaml, "move_factor:")
}

func TestRender_ColdAndBackup(t *testing.T) {
	input := defaultInput()
	input.ColdEnabled = true
	input.BackupEnabled = true
	input.S3AccessKey = "AKIAEXAMPLE"
	input.S3SecretKey = "secretexample"

	out, err := Render(input, defaultComputed())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	yaml := string(out)

	// Should have object disk (cold)
	assertContains(t, yaml, "type: s3")
	assertContains(t, yaml, "cache_enabled: true")

	// Should have backups disk
	assertContains(t, yaml, "type: s3_plain")
	assertContains(t, yaml, "clickhouse-backup/")

	// Should have policy
	assertContains(t, yaml, "local_primary:")
	assertContains(t, yaml, "move_factor: \"0.9\"")

	// Should have allowed_disk with both
	assertContains(t, yaml, "- object")
	assertContains(t, yaml, "- backups")
}

func TestRender_BackupWithDR(t *testing.T) {
	input := defaultInput()
	input.ColdEnabled = true
	input.BackupEnabled = true
	input.S3AccessKey = "AKIAEXAMPLE"
	input.S3SecretKey = "secretexample"
	input.DRS3Endpoint = "https://s3.eu-west-1.amazonaws.com/dr-bucket/"

	out, err := Render(input, defaultComputed())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	yaml := string(out)

	// Check DR backup disk exists
	assertContains(t, yaml, "backups_dr:")
	assertContains(t, yaml, "https://s3.eu-west-1.amazonaws.com/dr-bucket/")

	// Check DR disk has credentials
	assertContains(t, yaml, "access_key_id: AKIAEXAMPLE")

	// Check allowed_disk includes DR
	assertContains(t, yaml, "- backups_dr")
	assertContains(t, yaml, "- object")
	assertContains(t, yaml, "- backups")
}

func TestRender_S3CustomEndpoint(t *testing.T) {
	input := defaultInput()
	input.S3Endpoint = "https://minio.local:9000/mybucket/"

	out, err := Render(input, defaultComputed())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	yaml := string(out)

	// Custom endpoint used as-is (should include full path to bucket)
	assertContains(t, yaml, "endpoint: https://minio.local:9000/mybucket/")
}

func TestRender_S3MaxDataPartSize(t *testing.T) {
	input := defaultInput()
	input.MaxDataPartSizeBytes = 5368709120 // 5GB

	out, err := Render(input, defaultComputed())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	yaml := string(out)

	assertContains(t, yaml, "max_data_part_size_bytes: 5368709120")
}

func TestBuildS3Endpoint(t *testing.T) {
	tests := []struct {
		name     string
		endpoint string
		bucket   string
		region   string
		want     string
	}{
		{
			name:   "default AWS endpoint",
			bucket: "mybucket",
			region: "us-east-1",
			want:   "https://s3.us-east-1.amazonaws.com/mybucket/",
		},
		{
			name:     "custom endpoint without trailing slash",
			endpoint: "https://minio.local:9000/data",
			bucket:   "data",
			region:   "us-east-1",
			want:     "https://minio.local:9000/data/",
		},
		{
			name:     "custom endpoint with trailing slash",
			endpoint: "https://minio.local:9000/data/",
			bucket:   "data",
			region:   "us-east-1",
			want:     "https://minio.local:9000/data/",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := buildS3Endpoint(tt.endpoint, tt.bucket, tt.region)
			if got != tt.want {
				t.Errorf("buildS3Endpoint() = %q, want %q", got, tt.want)
			}
		})
	}
}

func assertContains(t *testing.T, haystack, needle string) {
	t.Helper()
	if !strings.Contains(haystack, needle) {
		t.Errorf("expected output to contain %q, but it did not.\nFull output:\n%s", needle, haystack)
	}
}

func assertNotContains(t *testing.T, haystack, needle string) {
	t.Helper()
	if strings.Contains(haystack, needle) {
		t.Errorf("expected output NOT to contain %q, but it did.\nFull output:\n%s", needle, haystack)
	}
}
