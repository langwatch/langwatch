// Package openapi contains the code generated from the LangWatch OpenAPI
// specification: typed request/response models and a low-level net/http client.
//
// Nothing in this package is part of the SDK's public surface. Consumers should
// use the ergonomic, hand-written wrapper in the parent package
// (github.com/langwatch/langwatch/sdk-go/client) instead, which is documented,
// stable, and shields callers from regeneration churn. The contents of
// zz_generated.gen.go are produced by `go generate` and must not be hand-edited.
//
// # Regeneration
//
// The generated code is committed so `go build` works without any toolchain
// beyond Go itself. To regenerate after the API spec changes, run from the
// client module root:
//
//	go generate ./...
//
// The directive below performs two steps:
//
//  1. Down-convert the canonical OpenAPI 3.1 document
//     (langwatch/src/app/api/openapiLangWatch.json) to a 3.0.3-compatible
//     temporary file via downconvert.py, because oapi-codegen (kin-openapi)
//     does not parse 3.1. The canonical spec is never modified.
//  2. Run oapi-codegen with oapi-codegen.yaml to emit zz_generated.gen.go.
package openapi

//go:generate sh -c "python3 downconvert.py ../../../../langwatch/src/app/api/openapiLangWatch.json ./openapi-3.0.json && go run github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@v2.7.1 -config oapi-codegen.yaml ./openapi-3.0.json && rm -f ./openapi-3.0.json"
