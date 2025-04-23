# LangWatch Python SDK 🐍

A Python SDK to monitor and observe your LLM applications using LangWatch.

> [!CAUTION]
> This SDK is currently being developed and is not yet ready for production use. Please use the [legacy SDK](../../python-sdk-legacy/) until this notice is removed.

## Migration progress

### Legend

-   ✅: Complete
-   🚧: Migration in progress
-   ❌: Pending migration
-   ⚰: Deprecated
-   🗑️: Removed

### Migration progress

| Feature                                | Status | Tested | Description                                               |
| -------------------------------------- | ------ | ------ | --------------------------------------------------------- |
| `endpoint`                             | ✅     | 🔄     |                                                           |
| `api_key`                              | 🗑️     | 🔄     | This has been removed.                                    |
| `enabled`                              | 🗑️     | 🔄     |                                                           |
| `sampling_rate`                        | ✅     | 🔄     |                                                           |
| `logger`                               | ✅     | 🔄     |                                                           |
| `trace`                                | ✅     | 🔄     |                                                           |
| `span`                                 | ✅     | 🔄     |                                                           |
| `get_current_trace`                    | ✅     | 🔄     |                                                           |
| `get_current_span`                     | ✅     | 🔄     |                                                           |
| `create_span`                          | 🗑️     | 🔄     | This was marked for deprecation, and has been deprecated. |
| `capture_rag`                          | 🗑️     | 🔄     | This was marked for deprecation, and has been deprecated. |
| `langchain`                            | ✅     | 🔄     |                                                           |
| `dspy`                                 | ✅     | 🔄     |                                                           |
| `login`                                | ❌     | 🔄     |                                                           |
| `evaluations`                          | ✅     | 🔄     |                                                           |
| `guardrails`                           | ✅     | 🔄     |                                                           |
| `openai`                               | ✅     | 🔄     |                                                           |
| `litellm`                              | ✅     | 🔄     |                                                           |
| `ContextSpan`                          | ✅     | 🔄     |                                                           |
| `ContextSpan.update`                   | ✅     | 🔄     |                                                           |
| `ContextSpan.add_evaluation`           | ✅     | 🔄     |                                                           |
| `ContextSpan.evaluate`                 | ✅     | 🔄     |                                                           |
| `ContextSpan.async_evaluate`           | ✅     | 🔄     |                                                           |
| `ContextSpan.end`                      | ✅     | 🔄     |                                                           |
| `ContextTrace`                         | ✅     | 🔄     |                                                           |
| `ContextTrace.update`                  | ✅     | 🔄     |                                                           |
| `ContextTrace.add_evaluation`          | ✅     | 🔄     |                                                           |
| `ContextTrace.evaluate`                | ✅     | 🔄     |                                                           |
| `ContextTrace.async_evaluate`          | ✅     | 🔄     |                                                           |
| `ContextTrace.deferred_send_spans`     | 🗑️     | 🔄     |                                                           |
| `ContextTrace.send_spans`              | 🗑️     | 🔄     |                                                           |
| `ContextTrace.append_span`             | 🗑️     | 🔄     |                                                           |
| `ContextTrace.get_parent_id`           | 🗑️     | 🔄     |                                                           |
| `ContextTrace.get_current_span`        | ✅     | 🔄     |                                                           |
| `ContextTrace.set_current_span`        | 🗑️     | 🔄     |                                                           |
| `ContextTrace.reset_current_span`      | 🗑️     | 🔄     |                                                           |
| `ContextTrace.get_langchain_callback`  | ✅     | 🔄     |                                                           |
| `ContextTrace.autotrack_openai_calls`  | ✅     | 🔄     |                                                           |
| `ContextTrace.autotrack_litellm_calls` | ✅     | 🔄     |                                                           |
| `ContextTrace.autotrack_dspy`          | ✅     | 🔄     |                                                           |
| `ContextTrace.share`                   | ✅     | 🔄     |                                                           |
| `ContextTrace.unshare`                 | ✅     | 🔄     |                                                           |

## Installation

```bash
pip install langwatch==0.3.0rc1
```

## Usage

Set the following environment variables:

- `LANGWATCH_API_KEY`: Your LangWatch API key.
- `LANGWATCH_ENDPOINT`: Your LangWatch endpoint, this is only required if you are using a self-hosted LangWatch instance.

```python
import langwatch
import os
from openai import OpenAI

@langwatch.trace()
def main():
    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    langwatch.get_current_trace().autotrack_openai_calls(client)

    # Any calls to OpenAI will now be tracked by LangWatch

```

## Contributing

We welcome contributions to LangWatch! Here's how you can help:

1. Fork the repository
2. Create a new branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run the tests (`pytest`)
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

Please make sure to update tests as appropriate and follow our coding standards.

## Support

- Documentation: [docs.langwatch.ai](https://docs.langwatch.ai)
- Issues: [GitHub Issues](https://github.com/langwatch/langwatch/issues)
- Discord: [Join our community](https://discord.gg/langwatch)
- Email: [support@langwatch.ai](mailto:support@langwatch.ai)
