package config

import "fmt"

// LogFields returns the effective config as key/value pairs for
// structured logging. Secrets are replaced with a redacted-but-
// informative marker — operators can verify whether a secret is set
// and roughly how long it is, without the value ever hitting logs or
// log aggregators. Called once at startup so operators can grep for
// `gateway_effective_config` and see which overrides took effect.
func (c *Config) LogFields() []any {
	return []any{
		"listen_addr", c.ListenAddr,
		"admin_addr", c.AdminAddr,
		"admin_auth_token", redact(c.AdminAuthToken),
		"log_level", c.LogLevel,
		"control_plane_base_url", c.ControlPlane.BaseURL,
		"control_plane_internal_secret", redact(c.ControlPlane.InternalSecret),
		"control_plane_jwt_secret", redact(c.ControlPlane.JWTSecret),
		"control_plane_jwt_secret_previous", redact(c.ControlPlane.JWTSecretPrevious),
		"control_plane_request_timeout", c.ControlPlane.RequestTimeout.String(),
		"control_plane_long_poll_timeout", c.ControlPlane.LongPollTimeout.String(),
		"cache_lru_size", c.Cache.LRUSize,
		"cache_redis_url", redact(c.Cache.RedisURL),
		"cache_refresh_interval", c.Cache.RefreshInterval.String(),
		"cache_bootstrap_all_keys", c.Cache.BootstrapAllKeys,
		"cache_jwt_refresh_threshold", c.Cache.JWTRefreshThreshold.String(),
		"budget_outbox_flush_interval", c.Budget.OutboxFlushInterval.String(),
		"budget_outbox_max_retries", c.Budget.OutboxMaxRetries,
		"budget_live_threshold_pct", c.Budget.LiveThresholdPct,
		"budget_live_timeout", c.Budget.LiveTimeout.String(),
		"guardrail_pre_timeout", c.Guardrails.PreTimeout.String(),
		"guardrail_post_timeout", c.Guardrails.PostTimeout.String(),
		"guardrail_stream_chunk_window", c.Guardrails.StreamChunkWindow.String(),
		"otel_default_endpoint", c.OTel.DefaultExportEndpoint,
		"otel_batch_timeout", c.OTel.BatchTimeout.String(),
		"otel_max_queue_size", c.OTel.MaxQueueSize,
		"bifrost_pool_size", c.Bifrost.PoolSize,
		"bifrost_stream_buffer_size", c.Bifrost.StreamBufferSize,
		"startup_netcheck_hosts", c.Startup.NetcheckHostsRaw,
		"startup_netcheck_timeout", c.Startup.NetcheckTimeout.String(),
		"security_max_request_body_bytes", c.Security.MaxRequestBodyBytes,
		"security_read_header_timeout", c.Security.ReadHeaderTimeout.String(),
		"security_read_timeout", c.Security.ReadTimeout.String(),
		"security_idle_timeout", c.Security.IdleTimeout.String(),
		"shutdown_pre_drain_wait", c.Shutdown.PreDrainWait.String(),
		"shutdown_timeout", c.Shutdown.Timeout.String(),
	}
}

// redact replaces a secret with "set(len=N)" or "unset" so operators
// can differentiate a missing secret from a configured one, and
// roughly sanity-check length (catches env-var truncation bugs like
// forgetting to quote a value with special chars).
func redact(s string) string {
	if s == "" {
		return "unset"
	}
	return fmt.Sprintf("set(len=%d)", len(s))
}
