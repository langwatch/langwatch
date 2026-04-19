SHELL := /bin/bash

.PHONY: build test test-unit test-integration lint run tidy fmt helm-lint helm-dry-run helm-e2e-smoke

build:
	go build -o bin/gateway ./cmd/gateway

test: test-unit

test-unit:
	go test -race -count=1 ./...

test-integration:
	go test -race -count=1 -tags=integration ./tests/integration/...

run:
	GATEWAY_ALLOW_INSECURE=1 GATEWAY_LOG_LEVEL=debug go run ./cmd/gateway

tidy:
	go mod tidy

fmt:
	go fmt ./...
	goimports -w .

# --- Helm chart validation ---------------------------------------------------

CHART := ../../infrastructure/charts/gateway

helm-lint:
	helm lint $(CHART)

# Renders the chart twice (default and NetworkPolicy-on) and asserts the
# invariant the CI workflow also enforces. Purely local; no cluster.
helm-dry-run:
	helm template gateway $(CHART) --dry-run > /tmp/gateway-defaults.yaml
	helm template gateway $(CHART) --set networkPolicy.enabled=true --set redis.url=redis://test:6379 --dry-run > /tmp/gateway-netpol.yaml
	@grep -q "kind: NetworkPolicy" /tmp/gateway-netpol.yaml || (echo "FAIL: NetworkPolicy missing when enabled" && exit 1)
	@! grep -q "kind: NetworkPolicy" /tmp/gateway-defaults.yaml || (echo "FAIL: NetworkPolicy rendered by default" && exit 1)
	@echo "OK: both renders valid"

# Server-side dry-run against the currently-configured kubectl context.
# Assumes the caller has already pointed kubectl at the target cluster
# (e.g. `aws eks update-kubeconfig --profile lw-dev --region eu-central-1
# --name langwatch-dev-ekscluster-runtime`). Renders the chart, pipes the
# manifest through `kubectl apply --dry-run=server`, and reports which
# resources would be created. Catches cluster-specific issues (CRDs,
# admission webhooks, RBAC) that pure-local rendering misses.
#
# Override HELM_NS / HELM_SECRETS_NAME if you're not on the default
# langwatch-dev setup.
HELM_NS ?= langwatch
HELM_SECRETS_NAME ?= langwatch-gateway-test-secrets

helm-e2e-smoke:
	@kubectl config current-context >/dev/null
	@echo "→ rendering chart for namespace $(HELM_NS)"
	@helm template gateway $(CHART) \
		--namespace $(HELM_NS) \
		--set image.tag=dev \
		--set ingress.enabled=false \
		--set secrets.existingSecretName=$(HELM_SECRETS_NAME) \
		| kubectl apply --dry-run=server --validate=true -f - \
		| tee /tmp/gateway-smoke.out
	@echo "→ asserting core resources"
	@grep -q "configmap/gateway-langwatch-gateway" /tmp/gateway-smoke.out
	@grep -q "deployment.apps/gateway-langwatch-gateway" /tmp/gateway-smoke.out
	@grep -q "service/gateway-langwatch-gateway" /tmp/gateway-smoke.out
	@echo "OK: chart renders cleanly against $$(kubectl config current-context)"
