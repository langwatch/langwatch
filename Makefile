.PHONY: start

install:
	cd langwatch && npm install
	cd langwatch_nlp && make install

start:
	cd langwatch && ./node_modules/.bin/concurrently --kill-others 'npm run dev' 'cd ../langwatch_nlp && make start'
