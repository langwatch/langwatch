from langwatch.attributes import AttributeName
from openai import OpenAI
import langwatch
from langwatch.instrumentors import OpenAIInstrumentor


langwatch.setup(
  base_attributes={AttributeName.ServiceName: "langwatch-openai-example"},
  instrumentors=[OpenAIInstrumentor],
)

@langwatch.span(type="span")
async def long_running_task():
  return 10

@langwatch.trace()
async def main():
  langwatch.get_current_trace().autotrack_openai_calls()

  question = "Write me a Taylor Swift song"
  client = OpenAI()
  completion = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": question}],
    stream=True,
    stream_options={"include_usage": True},
  )

  await long_running_task()

  tokens = (
      part.choices[0].delta.content or ""
      for part in completion
      if len(part.choices) > 0 and part.choices[0].delta.content
  )
