# The ACME checkout demo application: the LangGraph application Langy
# instruments during the guided onboarding.
#
#   make dogfood-langy-local

.PHONY: dogfood-langy-local

PORT ?= 8767

dogfood-langy-local:
	cd python && uv run uvicorn app.main:app --reload --port $(PORT)
