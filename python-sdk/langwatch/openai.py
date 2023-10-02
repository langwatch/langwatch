import nanoid
import openai
from contextlib import contextmanager

_original_completion_create = openai.Completion.create


@contextmanager
def trace():
    trace_id = nanoid.generate()

    def patched_completion_create(*args, **kwargs):
        response = _original_completion_create(*args, **kwargs)
        print(f"[{trace_id}] Response from OpenAI:", response)
        return response

    openai.Completion.create = patched_completion_create

    yield

    openai.Completion.create = _original_completion_create
