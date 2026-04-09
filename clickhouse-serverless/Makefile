IMAGE     ?= clickhouse-serverless
TAG       ?= test
PLATFORM  ?= linux/$(shell go env GOARCH)
HELM_DIR  ?= ../charts/clickhouse-serverless

.PHONY: test lint build e2e e2e-cold e2e-cold-move e2e-backup clean help

help: ## Show this help
	@grep -E '^[a-z][a-z0-9_-]+:.*##' $(MAKEFILE_LIST) | awk -F ':.*##' '{printf "  %-14s %s\n", $$1, $$2}'

test: ## Run Go unit tests
	go test -race -count=1 ./...

lint: ## Run go vet + helm lint + helm template
	go vet ./...
	@command -v helm >/dev/null || { echo "helm not installed, skipping"; exit 0; }
	helm lint $(HELM_DIR)
	helm template test $(HELM_DIR) --set cpu=4,memory=8Gi > /dev/null
	helm template test-ha $(HELM_DIR) --set cpu=4,memory=8Gi,replicas=3 > /dev/null

build: ## Build Docker image
	docker build -t $(IMAGE):$(TAG) --platform=$(PLATFORM) .

e2e: build ## E2E: build image, start ClickHouse, verify settings via SQL
	@tests/e2e-test.sh $(IMAGE):$(TAG)

e2e-cold: build ## E2E with cold storage: build image, start Garage + ClickHouse, verify
	@tests/e2e-cold-test.sh $(IMAGE):$(TAG)

e2e-cold-move: build ## E2E: verify data moves from hot to cold (S3) storage via TTL
	@tests/e2e-cold-move-test.sh $(IMAGE):$(TAG)

e2e-backup: build ## E2E: native BACKUP/RESTORE cycle via S3 backups disk
	@tests/e2e-backup-test.sh $(IMAGE):$(TAG)

clean: ## Stop and remove test containers
	@docker rm -f ch-e2e garage-e2e 2>/dev/null || true
	@docker network rm ch-test-net 2>/dev/null || true
