module github.com/langwatch/langwatch/pkg

go 1.27.1

require (
	github.com/go-playground/validator/v10 v10.30.2
	github.com/golang-jwt/jwt/v5 v5.3.1
	github.com/grafana/pyroscope-go v1.4.2
	github.com/hashicorp/golang-lru/v2 v2.0.7
	github.com/stretchr/testify v1.12.1
	github.com/thessem/zap-prettyconsole v0.6.0
	github.com/tidwall/gjson v1.19.0
	go.opentelemetry.io/collector/pdata v1.57.0
	go.opentelemetry.io/contrib/bridges/otelzap v0.20.1
	go.opentelemetry.io/contrib/instrumentation/runtime v0.71.0
	go.opentelemetry.io/otel v1.46.0
	go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp v0.22.0
	go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp v1.46.0
	go.opentelemetry.io/otel/exporters/otlp/otlptrace v1.46.0
	go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp v1.46.0
	go.opentelemetry.io/otel/metric v1.46.0
	go.opentelemetry.io/otel/sdk v1.46.0
	go.opentelemetry.io/otel/sdk/log v0.22.0
	go.opentelemetry.io/otel/sdk/metric v1.46.0
	go.opentelemetry.io/otel/trace v1.46.0
	go.opentelemetry.io/proto/otlp v1.11.0
	go.uber.org/zap v1.28.0
	google.golang.org/protobuf v1.36.12
	gopkg.in/yaml.v3 v3.0.1
)

require (
	github.com/Code-Hex/dd v1.1.0 // indirect
	github.com/cenkalti/backoff/v5 v5.0.3 // indirect
	github.com/cespare/xxhash/v2 v2.3.0 // indirect
	github.com/gabriel-vasile/mimetype v1.4.13 // indirect
	github.com/go-logr/logr v1.4.4 // indirect
	github.com/go-logr/stdr v1.2.2 // indirect
	github.com/go-playground/locales v0.14.1 // indirect
	github.com/go-playground/universal-translator v0.18.1 // indirect
	github.com/google/uuid v1.6.0 // indirect
	github.com/grafana/pyroscope-go/godeltaprof v0.1.11 // indirect
	github.com/grpc-ecosystem/grpc-gateway/v2 v2.30.0 // indirect
	github.com/hashicorp/go-version v1.9.0 // indirect
	github.com/json-iterator/go v1.1.12 // indirect
	github.com/klauspost/compress v1.18.7 // indirect
	github.com/leodido/go-urn v1.4.0 // indirect
	github.com/modern-go/concurrent v0.0.0-20180306012644-bacd9c7ef1dd // indirect
	github.com/modern-go/reflect2 v1.0.3-0.20250322232337-35a7c28c31ee // indirect
	github.com/pkg/errors v0.9.1 // indirect
	github.com/tidwall/match v1.1.1 // indirect
	github.com/tidwall/pretty v1.2.1 // indirect
	go.opentelemetry.io/auto/sdk v1.2.1 // indirect
	go.opentelemetry.io/collector/featuregate v1.57.0 // indirect
	go.opentelemetry.io/otel/log v0.22.0 // indirect
	go.uber.org/multierr v1.11.0 // indirect
	go.yaml.in/yaml/v3 v3.0.5 // indirect
	golang.org/x/crypto v0.55.0 // indirect
	golang.org/x/net v0.58.0 // indirect
	golang.org/x/sys v0.47.0 // indirect
	golang.org/x/text v0.41.0 // indirect
	google.golang.org/genproto/googleapis/api v0.0.0-20260819154853-08b0e4226688 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20260819154853-08b0e4226688 // indirect
	google.golang.org/grpc v1.83.1 // indirect
)

// Monorepo: the in-tree sdk-go directory IS the source of truth for
// every root-module consumer (nlpgo, aigateway, …). Changes to sdk-go
// flow with nlpgo changes in the same commit — same pattern python-sdk
// + langwatch_nlp use, and the reason a monorepo exists in the first
// place. The `require` line above pins a published version for
// external (out-of-tree) consumers who fetch via the proxy;
// release-please cuts those tags. In this repo, this replace always
// wins.
