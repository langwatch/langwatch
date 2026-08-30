# Connected agent examples

These examples connect a Python function to LangWatch Agent Testing with `langwatch.connect_agent`. The platform sends simulation turns to the process you run. No public URL, no tunnel and no request template are needed.

## Files

- `support_agent.py`: a support agent on `gpt-5-mini`. Run it with `python support_agent.py`. The script blocks in `langwatch.agent.serve()` until Ctrl-C.
- `support_agent_fastapi.py`: the same function inside a FastAPI application. Run it with `uvicorn support_agent_fastapi:app`. The import of the module starts the connection. The web server keeps the process alive.

## Setup

1. Install the SDK and the example dependencies: `pip install langwatch openai fastapi uvicorn python-dotenv`.
2. Set `LANGWATCH_API_KEY` to the API key of your project.
3. Set `OPENAI_API_KEY`.
4. Start one of the examples. The agent shows as Online on the Agents page of your project.

## How the function is called

The platform sends the same turn fields on every call: `messages`, `new_messages`, `thread_id`, `session` and `trace_id`. The function receives the ones it declares. A function with `**kwargs` receives all of them.

Every other parameter with a default is a run parameter. The type comes from the annotation. `Literal[...]` and `Enum` become a list of options. `Annotated[T, langwatch.Param(description=...)]` adds a description. A parameter with no default is required, and the run must supply it.

The function returns a string, one message, a list of messages, or `langwatch.AgentReply(output, session=...)`. The `session` value comes back on the next turn of the same `thread_id`.

## Environment variables

| Variable | Effect |
|---|---|
| `LANGWATCH_API_KEY` | The API key. Without it the agent is not connected and one warning is logged. |
| `LANGWATCH_ENDPOINT` | The LangWatch endpoint. The socket URL is derived from it. |
| `LANGWATCH_PROJECT_ID` | The project, when the key reaches more than one project. The `project_id` argument of the decorator wins over it. |
| `LANGWATCH_AGENT_ENVIRONMENT` | The environment shown next to the agent. `APP_ENV`, `ENVIRONMENT` and `NODE_ENV` are read after it. The default is `development`. |
| `LANGWATCH_AGENT_CONNECT` | `0` or `false` disables the connection. |
| `LANGWATCH_AGENT_INSTANCE_LABEL` | A label for this process, shown in the instance list. |
| `CI` | When truthy the connection is disabled, unless `enabled=True` is passed. |

## TLS

The connection uses `wss://` with the system trust store. For a self-hosted LangWatch behind a private certificate authority, set `SSL_CERT_FILE` to the CA bundle path.
