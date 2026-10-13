# Directory paths
DOCS_DIR = api-reference
API_SPEC_FILE = openapiLangWatch.json
# The OpenAPI document is generated from the api's route declarations and never
# committed. Mintlify builds the site from the repository alone and cannot run
# the generator, so the site keeps a committed copy under its historical name;
# docs CI regenerates it and fails when it is stale.
GENERATED_SPEC = ../specs/api-reference/openapi-document.json


.PHONY: sync-api-spec
sync-api-spec:
	@echo "Generating the OpenAPI document and copying it into the docs site..."
	@cd .. && pnpm --filter @langwatch/platform-api run openapi:generate
	@mkdir -p $(DOCS_DIR)
	@cp $(GENERATED_SPEC) $(DOCS_DIR)/$(API_SPEC_FILE)
	@echo "✅ API specification synced to $(DOCS_DIR)/$(API_SPEC_FILE)"

.PHONY: generate-openapi-evals
generate-openapi-evals:
	@echo "Generating OpenAPI spec for evaluators from langevals..."
	@node scripts/generate-openapi-evals.ts
	@echo "✅ Evaluators OpenAPI spec generated successfully"

.PHONY: generate-api-reference
generate-api-reference:
	@echo "Generating API reference pages from OpenAPI spec..."
	@node --experimental-transform-types --no-warnings scripts/generate-api-reference-pages.ts
	@echo "✅ API reference pages generated and docs.json updated"

.PHONY: view-docs
preview:
	@echo "Viewing docs..."
	@npx mintlify dev
	make open

.PHONY: open
open:
	@npx mintlify open

# Prose linter: the judged half of the writing rules, run by hand because the
# Jev key is not in CI. It lives outside docs/ because Mintlify serves every
# .mdx under this directory as a page, and its fixtures break the rules on
# purpose. ../dev/scripts/prose-lint/README.md has the rules and the cost.
PROSE_LINT = ../dev/scripts/prose-lint/lint.mjs
RULES ?= docs

.PHONY: lint-prose
lint-prose:
	@test -n "$(FILES)" || { echo 'usage: make lint-prose FILES="langy/overview.mdx [more pages]" [RULES=docs|writing|both]'; exit 2; }
	@node $(PROSE_LINT) $(FILES) --rules $(RULES)

.PHONY: lint-prose-changed
lint-prose-changed:
	@base=$$(git merge-base origin/main HEAD) || { echo "cannot find the merge base with origin/main; fetch origin first" >&2; exit 2; }; \
	files=$$(git diff --name-only --diff-filter=d "$$base" -- .. | grep '^docs/.*\.mdx$$' | sed 's|^docs/||'); \
	if [ -z "$$files" ]; then echo "no docs pages changed against origin/main"; exit 0; fi; \
	echo "linting:"; echo "$$files" | sed 's|^|  |'; \
	node $(PROSE_LINT) $$files --rules $(RULES)