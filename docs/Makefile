# Directory paths
DOCS_DIR = api-reference
API_SPEC_FILE = openapiLangWatch.json
GITHUB_RAW_URL = https://raw.githubusercontent.com/langwatch/langwatch/main/langwatch/src/app/api/$(API_SPEC_FILE)


.PHONY: sync-api-spec
sync-api-spec:
	@echo "Syncing OpenAPI specification from main repository..."
	@mkdir -p $(DOCS_DIR)
	@curl -s $(GITHUB_RAW_URL) > $(DOCS_DIR)/$(API_SPEC_FILE)
	@echo "✅ API specification synced successfully to $(DOCS_DIR)/$(API_SPEC_FILE)"

.PHONY: generate-openapi-evals
generate-openapi-evals:
	@echo "Generating OpenAPI spec for evaluators from langevals..."
	@npx tsx scripts/generate-openapi-evals.ts
	@echo "✅ Evaluators OpenAPI spec generated successfully"

.PHONY: view-docs
preview:
	@echo "Viewing docs..."
	@npx mintlify dev
	make open

.PHONY: open
open:
	@npx mintlify open