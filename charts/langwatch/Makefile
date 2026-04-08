RELEASE   := lw
NAMESPACE := lw-local
KIND_CLUSTER := lw-local
KUBE_CTX  := kind-$(KIND_CLUSTER)
CH_IMAGE  := langwatch/clickhouse-serverless:next
CH_CHART  := ../clickhouse-serverless
APP_IMAGE      := langwatch/langwatch:local
NLP_IMAGE      := langwatch/langwatch_nlp:local
LANGEVALS_IMAGE := langwatch/langevals:local
APP_DIR        := ../..
HELM_SAFE      := ./examples/helm-safe.sh

.PHONY: deps lint template test-e2e test-e2e-full test clean \
        images images-local \
        example-up example-down example-status

# ── Build ────────────────────────────────────────────────────────────────────

## Fetch/update chart dependencies (prometheus, clickhouse)
deps:
	helm dependency update .

## Build all images that have Dockerfiles in this repo
images:
	$(MAKE) -C $(CH_CHART) images
	docker build -t $(APP_IMAGE) $(APP_DIR)
	docker build -t $(NLP_IMAGE) -f $(APP_DIR)/Dockerfile.langwatch_nlp $(APP_DIR)
	docker build -t $(LANGEVALS_IMAGE) -f $(APP_DIR)/Dockerfile.langevals $(APP_DIR)

## Build + load all images into Kind
images-local: images
	kind load docker-image $(CH_IMAGE) --name $(KIND_CLUSTER)
	kind load docker-image $(APP_IMAGE) --name $(KIND_CLUSTER)
	kind load docker-image $(NLP_IMAGE) --name $(KIND_CLUSTER)
	kind load docker-image $(LANGEVALS_IMAGE) --name $(KIND_CLUSTER)

# ── Lint & Template ──────────────────────────────────────────────────────────

## Lint (runs deps first to ensure lock is current)
lint: deps
	helm lint . --set autogen.enabled=true

## Render all ClickHouse modes and validate YAML
template: deps
	@echo "--- default (single CH, chart-managed) ---"
	@helm template $(RELEASE) . --set autogen.enabled=true > /dev/null && echo "OK"
	@echo "--- replicated CH (3 nodes) ---"
	@helm template $(RELEASE) . --set autogen.enabled=true \
	    --set 'clickhouse.replicas=3' > /dev/null && echo "OK"
	@echo "--- external CH ---"
	@helm template $(RELEASE) . --set autogen.enabled=true \
	    --set clickhouse.chartManaged=false \
	    --set 'clickhouse.external.url.value=http://u:p@ch:8123/default' > /dev/null && echo "OK"
	@echo "--- external values file ---"
	@helm template $(RELEASE) . \
	    -f examples/values-clickhouse-external.yaml \
	    --set autogen.enabled=true > /dev/null && echo "OK"

# ── Testing ──────────────────────────────────────────────────────────────────

## Deploy to Kind and run functional tests (CI)
test-e2e: deps
	bash tests/e2e.sh

## Test overlay combinations (template rendering + live installs)
test-e2e-overlays: deps
	bash tests/e2e-overlays.sh

## Deploy full stack to Kind and run integration tests (all images required)
test-e2e-full: deps
	bash tests/e2e-full-stack.sh

## Run all checks: lint + template + e2e + overlays
test: lint template test-e2e test-e2e-overlays

# ── Local Development ────────────────────────────────────────────────────────

## Spin up LangWatch locally.  Usage: make example-up [PROFILE=local]
## Profiles: local, hosted-dev, hosted-prod, scalable-prod, test
## Creates Kind cluster and builds images automatically if needed.
example-up: deps
	@if ! kind get clusters 2>/dev/null | grep -q "^$(KIND_CLUSTER)$$"; then \
	  echo "Creating Kind cluster: $(KIND_CLUSTER)"; \
	  kind create cluster --name $(KIND_CLUSTER) --config ../lib/kind-config.yaml --wait 60s; \
	fi
	@if ! docker image inspect $(CH_IMAGE) &>/dev/null || ! docker image inspect $(APP_IMAGE) &>/dev/null || ! docker image inspect $(NLP_IMAGE) &>/dev/null || ! docker image inspect $(LANGEVALS_IMAGE) &>/dev/null; then \
	  $(MAKE) images; \
	fi
	@kind load docker-image $(CH_IMAGE) --name $(KIND_CLUSTER)
	@kind load docker-image $(APP_IMAGE) --name $(KIND_CLUSTER)
	@kind load docker-image $(NLP_IMAGE) --name $(KIND_CLUSTER)
	@kind load docker-image $(LANGEVALS_IMAGE) --name $(KIND_CLUSTER)
	$(HELM_SAFE) upgrade --install $(RELEASE) . \
	  -f examples/values-$(or $(PROFILE),local).yaml \
	  --wait --timeout 10m

## Tear down the example release
example-down:
	$(HELM_SAFE) uninstall $(RELEASE) || true
	kubectl --context $(KUBE_CTX) delete namespace $(NAMESPACE) --wait=false 2>/dev/null || true

## Show pod status
example-status:
	kubectl --context $(KUBE_CTX) -n $(NAMESPACE) get pods

## Delete the Kind cluster entirely
clean:
	-kind delete cluster --name $(KIND_CLUSTER) 2>/dev/null || true
