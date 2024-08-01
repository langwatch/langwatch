# LangWatch Python SDK

Go to [https://docs.langwatch.ai](https://docs.langwatch.ai/integration/python/guide) to get started.

## Contributing

After changing code, to test all integrations are working, run the examples integration test manually (you will need all env vars to be set up):

```
poetry run pytest tests/test_examples.py -s -x
```

Or to test only a specific example, run:

```
poetry run pytest tests/test_examples.py -s -x -k <example_name>
```