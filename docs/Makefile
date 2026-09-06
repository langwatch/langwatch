# Directory paths
DOCS_DIR = api-reference
API_SPEC_FILE = openapiLangWatch.json
CANONICAL_SPEC = ../platform/app/src/app/api/$(API_SPEC_FILE)


.PHONY: sync-api-spec
sync-api-spec:
	@echo "Copying the canonical OpenAPI specification into the docs site..."
	@mkdir -p $(DOCS_DIR)
	@cp $(CANONICAL_SPEC) $(DOCS_DIR)/$(API_SPEC_FILE)
	@echo "✅ API specification synced to $(DOCS_DIR)/$(API_SPEC_FILE)"

.PHONY: generate-openapi-evals
generate-openapi-evals:
	@echo "Generating OpenAPI spec for evaluators from langevals..."
	@npx tsx scripts/generate-openapi-evals.ts
	@echo "✅ Evaluators OpenAPI spec generated successfully"

.PHONY: generate-api-reference
generate-api-reference:
	@echo "Generating API reference pages from OpenAPI spec..."
	@../platform/app/node_modules/.bin/tsx scripts/generate-api-reference-pages.ts
	@echo "✅ API reference pages generated and docs.json updated"

.PHONY: view-docs
preview:
	@echo "Viewing docs..."
	@npx mintlify dev
	make open

.PHONY: open
open:
	@npx mintlify open