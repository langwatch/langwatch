# The ACME support demo applications: the customer application used to dogfood
# Langy local control. `lang` selects the twin that boots.
#
#   make dogfood-langy-local lang=python
#   make dogfood-langy-local lang=typescript

.PHONY: dogfood-langy-local

lang ?= python
PY_PORT ?= 8765
TS_PORT ?= 8766

dogfood-langy-local:
ifeq ($(lang),python)
	cd python && uv run uvicorn app.main:app --reload --port $(PY_PORT)
else ifeq ($(lang),typescript)
	cd typescript && PORT=$(TS_PORT) npm run dev
else
	@echo "lang must be python or typescript, got '$(lang)'" && exit 1
endif
