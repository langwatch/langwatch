# LangWatch Python SDK

Go to [https://docs.langwatch.ai](https://docs.langwatch.ai/integration/python/guide) to get started.

## Contributing

Install the dependencies:

```
make install
```

Open one of the examples on chainlit to test it:

```
make example examples/openai_bot.py
```

After changing code, to test all integrations are working, run the examples integration test manually (you will need all env vars to be set up):

```
make test-examples
```

Or to test only a specific example, run:

```
make test-examples -- -k <example_name>
```
