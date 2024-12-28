.PHONY: start

install:
	cd langwatch && npm install
	cd langwatch_nlp && make install

start:
	cd langwatch && ./node_modules/.bin/concurrently --kill-others 'npm run dev' 'cd ../langwatch_nlp && make start'

python-build:
	uv pip install build && uv run python -m build

python-install:
	pip install --no-cache-dir --force-reinstall dist/langwatch_server-*-py3-none-any.whl
