"""A scripted OpenAI-compatible model server for recording langevals' LLM evaluators.

It runs in-process on 127.0.0.1, answers `/chat/completions` and `/embeddings`
from the running case's `script`, and keeps every call it received. Answers are
a function of the request and the script only, so a recording is reproducible.
FORMAT.md is the contract for what gets recorded.

Script knobs (all optional, per corpus case):
  values          field -> value, applied at any depth of a tool's arguments or
                  a ragas JSON answer; dspy output fields read it too.
  refuse_forced   a forced tool_choice gets a 400 naming tool_choice.
  no_tool_call    a tools request is answered with text only, unless reminded.
  partial_tool_call  the first tool call leaves out its last required field.
  arguments_raw   the tool call's arguments, verbatim (e.g. text that is not JSON).
  finish_reason   overrides the finish_reason of every answer.
  malformed       a ragas prompt is answered with broken JSON; its repair
                  prompt is answered properly.
  ignore_n        one choice, whatever `n` asked for.
"""

import hashlib
import json
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# Transport details litellm adds that are not part of the call's meaning.
DROPPED_FIELDS = ("stream", "metadata", "user")

REMINDER_MARKER = "Answer only by calling the `"
SCHEMA_MARKER = "JSON Schema:\n"
REPAIR_INPUT = "following input\ninput: "
DSPY_OUTPUT_FIELDS = re.compile(r"Your output fields are:\n(.*?)\n\n", re.S)
DSPY_FIELD = re.compile(r"^\d+\. `(\w+)` \(([^)]*)\)", re.M)
EMBEDDING_DIMS = 8


def vector(text: str) -> list[float]:
    """A deterministic 8-dim vector: bytes of the text's sha256, scaled to [-1, 1]."""
    digest = hashlib.sha256(text.encode("utf-8")).digest()
    return [(byte - 127.5) / 127.5 for byte in digest[:EMBEDDING_DIMS]]


def message_text(message: dict) -> str:
    content = message.get("content")
    if isinstance(content, list):
        return " ".join(part.get("text", "") for part in content if isinstance(part, dict))
    return content or ""


class Answerer:
    """Turns one request body into a response body, for one case's script."""

    def __init__(self, script: dict):
        self.script = script or {}
        self.values = self.script.get("values") or {}

    def fill(self, schema: dict, defs: dict, key: str = "", index: int = 0):
        if "$ref" in schema:
            schema = defs[schema["$ref"].split("/")[-1]]
        if "anyOf" in schema:
            schema = next((s for s in schema["anyOf"] if s.get("type") != "null"), schema["anyOf"][0])
        if key in self.values:
            return self.values[key]
        if "enum" in schema:
            return schema["enum"][0]
        kind = schema.get("type")
        if kind == "object" or "properties" in schema:
            return {
                name: self.fill(sub, defs, name, index)
                for name, sub in (schema.get("properties") or {}).items()
            }
        if kind == "array":
            return [self.fill(schema.get("items") or {}, defs, key, index)]
        if kind == "boolean":
            return True
        if kind == "integer":
            return 1
        if kind == "number":
            return 1.0
        suffix = f" {index}" if index else ""
        return f"Scripted {key or 'text'}{suffix}."

    def chat(self, body: dict) -> tuple[int, dict]:
        messages = body.get("messages") or []
        last = message_text(messages[-1]) if messages else ""
        tools = body.get("tools") or []
        tool_choice = body.get("tool_choice")
        forced = isinstance(tool_choice, dict) or tool_choice in ("required", "any")
        if tools and forced and self.script.get("refuse_forced"):
            return 400, {
                "error": {
                    "message": 'tool_choice: type "tool" and "any" are not supported for this model',
                    "type": "invalid_request_error",
                    "param": "tool_choice",
                    "code": None,
                }
            }
        n = 1 if self.script.get("ignore_n") else int(body.get("n") or 1)
        choices = [self.choice(body, messages, last, tools, tool_choice, i) for i in range(n)]
        prompt_tokens = len(json.dumps(messages, sort_keys=True)) // 4
        return 200, {
            "id": "chatcmpl-recorded",
            "object": "chat.completion",
            "created": 0,
            "model": body.get("model"),
            "choices": choices,
            "usage": {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": 10 * n,
                "total_tokens": prompt_tokens + 10 * n,
            },
        }

    def choice(self, body, messages, last, tools, tool_choice, index) -> dict:
        finish = self.script.get("finish_reason")
        if tools:
            reminded = REMINDER_MARKER in last
            if self.script.get("no_tool_call") and not reminded:
                return self.text_choice("I cannot help with that request.", finish or "stop", index)
            tool = self.tool(tools, tool_choice)
            parameters = tool.get("parameters") or {}
            arguments = self.fill(parameters, parameters.get("$defs") or {}, index=index)
            required = parameters.get("required") or []
            if self.script.get("partial_tool_call") and not reminded and required:
                arguments.pop(required[-1], None)
            raw = self.script.get("arguments_raw")
            return {
                "index": index,
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": f"call_recorded_{index}",
                            "type": "function",
                            "function": {
                                "name": tool.get("name"),
                                "arguments": raw if raw is not None else json.dumps(arguments),
                            },
                        }
                    ],
                },
                "finish_reason": finish or "tool_calls",
            }
        text = "\n".join(message_text(m) for m in messages)
        if "[[ ## " in text:
            return self.text_choice(self.dspy(text), finish or "stop", index)
        return self.text_choice(self.ragas(text, index), finish or "stop", index)

    @staticmethod
    def tool(tools: list, tool_choice) -> dict:
        name = None
        if isinstance(tool_choice, dict):
            name = (tool_choice.get("function") or {}).get("name")
        for tool in tools:
            function = tool.get("function") or {}
            if name is None or function.get("name") == name:
                return function
        return tools[0].get("function") or {}

    @staticmethod
    def text_choice(content: str, finish: str, index: int) -> dict:
        return {
            "index": index,
            "message": {"role": "assistant", "content": content},
            "finish_reason": finish,
        }

    def dspy(self, text: str) -> str:
        found = DSPY_OUTPUT_FIELDS.search(text)
        fields = DSPY_FIELD.findall(found.group(1)) if found else [("reasoning", "str")]
        parts = []
        for name, kind in fields:
            value = self.values.get(name, "True" if "bool" in kind else f"Scripted {name}.")
            parts.append(f"[[ ## {name} ## ]]\n{value}")
        return "\n\n".join(parts + ["[[ ## completed ## ]]"])

    def ragas(self, text: str, index: int, repairing: bool = False) -> str:
        """The JSON the prompt's schema asks for, filled from the script. A
        repair prompt carries the original prompt; it gets that prompt's answer."""
        start = text.find(SCHEMA_MARKER)
        if start < 0:
            return str(self.values.get("text", "True"))
        schema, _ = json.JSONDecoder().raw_decode(text[start + len(SCHEMA_MARKER):].lstrip())
        if schema.get("title") == "StringIO" and REPAIR_INPUT in text:
            repair, _ = json.JSONDecoder().raw_decode(text[text.rfind(REPAIR_INPUT) + len(REPAIR_INPUT):])
            return json.dumps({"text": self.ragas(repair["prompt_value"], index, repairing=True)})
        if self.script.get("malformed") and not repairing:
            return '{"broken": '
        return json.dumps(self.fill(schema, schema.get("$defs") or {}, index=index))

    def embedding(self, body: dict) -> tuple[int, dict]:
        inputs = body.get("input")
        if not isinstance(inputs, list) or (inputs and isinstance(inputs[0], int)):
            inputs = [inputs]
        texts = [item if isinstance(item, str) else json.dumps(item) for item in inputs]
        tokens = sum(len(text) // 4 + 1 for text in texts)
        return 200, {
            "object": "list",
            "data": [
                {"object": "embedding", "index": i, "embedding": vector(text)}
                for i, text in enumerate(texts)
            ],
            "model": body.get("model"),
            "usage": {"prompt_tokens": tokens, "total_tokens": tokens},
        }


class FakeLLM:
    """The server. `begin(script)` starts a case; `take()` ends it with its calls."""

    def __init__(self):
        self.lock = threading.Lock()
        self.calls: list[dict] = []
        self.answerer = Answerer({})
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                length = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(length) or b"{}")
                status, answer = fake.answer(self.path, body)
                raw = json.dumps(answer).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.server.server_address[1]}"

    def start(self) -> "FakeLLM":
        self.thread.start()
        return self

    def stop(self) -> None:
        self.server.shutdown()

    def begin(self, script: dict) -> None:
        with self.lock:
            self.calls = []
            self.answerer = Answerer(script)

    def take(self) -> list[dict]:
        with self.lock:
            calls, self.calls = self.calls, []
        # Concurrent calls arrive in any order: sort by the request itself,
        # stably, so identical requests keep the order they were answered in.
        return sorted(calls, key=lambda call: (call["kind"], canonical(call["request"])))

    def answer(self, path: str, body: dict) -> tuple[int, dict]:
        request = {key: value for key, value in body.items() if key not in DROPPED_FIELDS}
        with self.lock:
            if path.rstrip("/").endswith("/embeddings"):
                kind, (status, response) = "embedding", self.answerer.embedding(request)
            elif path.rstrip("/").endswith("/chat/completions"):
                kind, (status, response) = "chat", self.answerer.chat(request)
            else:
                return 404, {"error": {"message": f"no route {path}"}}
            call = {"kind": kind, "request": request, "response": response}
            if status != 200:
                call["status"] = status
            self.calls.append(call)
        return status, response


def canonical(value) -> str:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
