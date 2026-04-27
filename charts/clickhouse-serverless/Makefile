RELEASE   := ch-test
NAMESPACE := ch-test
CH_IMAGE  := langwatch/clickhouse-serverless:next
CH_DIR    := ../../clickhouse-serverless

.PHONY: lint template test-e2e test clean images

## Build the clickhouse-serverless Docker image
images:
	docker build -t $(CH_IMAGE) $(CH_DIR)

## Lint the chart
lint:
	helm lint .

## Render all deployment modes and validate YAML
template: lint
	@echo "--- single replica ---"
	@helm template $(RELEASE) . -f tests/values-single.yaml > /dev/null && echo "OK"
	@echo "--- replicated (3 nodes) ---"
	@helm template $(RELEASE) . -f tests/values-replicated.yaml > /dev/null && echo "OK"

## Deploy to Kind and run functional tests (requires: kind, helm, kubectl)
test-e2e:
	bash tests/e2e.sh

## Run all tests
test: template test-e2e

## Remove test Kind cluster
clean:
	-kind delete cluster --name ch-test 2>/dev/null || true
