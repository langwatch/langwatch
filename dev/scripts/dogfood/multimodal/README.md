# Multimodal dogfood matrix

Each cell in this directory sends one model call carrying one attachment,
an image or a PDF, through a LangWatch instrumentation, and prints what the
model saw. The point is to prove that an attachment sent through each
shipped SDK integration actually reaches the model and shows up on the
trace, not just that the code compiles.

The assets live in `assets/`:

- `langwatch-shapes.png`, an image with the words LANGWATCH and MULTIMODAL
  DOGFOOD, a blue circle, and a green triangle.
- `langwatch-invoice.pdf`, an invoice with number `LW-DOGFOOD-7339` and
  total `1337.42 EUR`.

A correct answer names those details. A generic or empty answer means the
attachment did not reach the model.

## Environment

Every cell needs a local LangWatch instance to send traces to:

```bash
export LANGWATCH_ENDPOINT=http://localhost:5590
export LANGWATCH_API_KEY=<your local project API key>
```

Model traffic for the OpenAI-shaped cells (`openai_official.py`,
`langgraph_openai.py`, `vercel-ai.ts`) goes through the LangWatch AI
Gateway:

```bash
export OPENAI_BASE_URL=https://gateway.langwatch.ai/v1
export OPENAI_API_KEY=<a gateway virtual key>
```

The other cells talk to their provider directly and need that provider's
own credentials:

- `anthropic_official.py`: `ANTHROPIC_API_KEY`
- `azure_openai.py`: `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`, and
  optionally `AZURE_OPENAI_DEPLOYMENT` (defaults to `gpt-5-mini`)
- `google_adk.py`: `GEMINI_API_KEY`
- `strands_bedrock.py`: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and
  `AWS_DEFAULT_REGION` set to a region with the EU cross-region inference
  profile, such as `eu-central-1`

`uv` runs every Python cell with no virtual environment to manage. Node
runs the TypeScript cell directly, since Node's built-in type stripping
handles the plain type annotations this file uses.

## Running one cell

Each Python cell is a normal script that takes `image` or `pdf` as its only
argument, defaulting to `image`:

```bash
cd python
uv run --with langwatch --with openai python openai_official.py image
uv run --with langwatch --with anthropic --with openinference-instrumentation-anthropic python anthropic_official.py pdf
```

See the docstring at the top of each file for its exact `uv run` command.

The TypeScript cell needs its dependencies installed once:

```bash
cd typescript
npm install
node vercel-ai.ts image
node vercel-ai.ts pdf
```

## Running all of them

```bash
./run.sh
```

This runs every cell in order, both modalities where a cell supports both,
and keeps going when a cell fails. Each cell prints its own report line
with the model's answer, then a plain `RESULT <cell> OK` or
`RESULT <cell> FAILED` line.

## Coverage

| Cell | Image | PDF | Notes |
|---|---|---|---|
| `openai_official.py` | yes | yes | OpenAI SDK, autotracked |
| `anthropic_official.py` | yes | yes | Anthropic SDK, `AnthropicInstrumentor` |
| `azure_openai.py` | yes | no | Azure OpenAI, autotracked |
| `google_adk.py` | yes | yes | Google ADK on Gemini, `GoogleADKInstrumentor` |
| `langgraph_openai.py` | yes | no | LangGraph, LangWatch's LangChain callback |
| `strands_bedrock.py` | yes | yes | Strands Agent on AWS Bedrock, built-in OpenTelemetry |
| `vercel-ai.ts` | yes | yes | Vercel AI SDK, `setupObservability` |
