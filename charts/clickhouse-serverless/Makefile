RELEASE   := ch-test
NAMESPACE := ch-test
CH_IMAGE  := langwatch/clickhouse-serverless:next
CH_DIR    := ../../infra/clickhouse-serverless

.PHONY: lint template test-e2e test-upgrade test clean images

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
	@echo "--- backup alerting rules ---"
	@helm template $(RELEASE) . -f tests/values-backup-alerts.yaml > /dev/null && echo "OK"
	@bash tests/backup-alerts.sh

## Deploy to Kind and run functional tests (requires: kind, helm, kubectl)
test-e2e:
	bash tests/e2e.sh

## Upgrade-access harness: old->new upgrade with pre-existing SQL access state.
## REPLICAS=3 is the real run; REPLICAS=1 is the AC24(b) negative control and
## MUST exit 20. Not part of `make test` — it deliberately runs to a red result.
## See tests/upgrade-access.sh for exit codes and the full env contract.
test-upgrade:
	bash tests/upgrade-access.sh

## Run all tests
test: template test-e2e

## Remove test Kind cluster
clean:
	-kind delete cluster --name ch-test 2>/dev/null || true
