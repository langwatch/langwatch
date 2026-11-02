# piidetector

A self-contained PII detection service with two levels. It returns spans; it does not mask,
store or call anything else. It is not wired into the product: the redaction path today is the
langevals Presidio evaluator (ADR-191). Why this is a separate service:
[ADR-193](../../dev/docs/adr/193-pii-detector-levels-service.md). Behaviour:
`specs/pii-detector/pii-detector-levels.feature`.

## Levels

**Level 0** is regular expressions plus checksum validators, no models
(`piidetector/level0.py`): emails, phone numbers (E.164 and national forms), card numbers
(Luhn plus issuer prefix or 4-4-4-4 grouping), IBANs (mod 97), IPv4 and IPv6, crypto wallets
(0x, base58check, bech32), the value after a password cue, API keys (known token prefixes and
the value after a key cue), dates of birth only after a birth cue, and national IDs that pass
their check (US SSN rules, Swedish personnummer, Dutch BSN, Spanish DNI, Italian codice fiscale,
Polish PESEL). It finds no names by design.

**Level 1** is, per text (`piidetector/combine.py`):

1. Level 0,
2. GLiNER multi-PII over 33 label prompts (`piidetector/gliner_labels.json`), fp32 ONNX,
3. PII-Tracer, keeping only `PERSON_NAME` spans scored at least 0.8267 (Tracer is there for the
   names GLiNER misses or labels as something else),
4. the union of 1 to 3 (the same start, end and label collapse into one span),
5. the name rule over that union (`piidetector/name_rule.py`): a name found once is masked
   everywhere else in the same text, and "Moreau, Lucie" is masked whole when either half was
   found.

Thresholds, window sizes and pinned model revisions are in `piidetector/models.py` and
`piidetector/combine.py`. They are the values the benchmark measured; changing one changes the
output.

## API

Both entrypoints take the same JSON request (`piidetector/service.py`):

```json
{ "texts": ["Lucie Moreau, lucie.moreau@example.com", "..."], "level": 1 }
```

```json
{
  "level": 1,
  "results": [
    {
      "spans": [
        { "start": 0, "end": 12, "label": "PERSON_NAME", "score": 0.93, "source": "gliner" },
        { "start": 14, "end": 38, "label": "EMAIL", "score": 0.98, "source": "level0+gliner" }
      ]
    }
  ]
}
```

(Abridged and with illustrative scores; a real answer also holds the name rule's spans for each
name word.)

- Offsets are Python string indices (Unicode code points) into each text; `results` follows the
  order of `texts`.
- `source` is `level0`, `gliner`, `tracer` or `name_rule`; a span several components found joins
  them with `+`. `score` is `null` for Level 0 and name-rule spans.
- Spans can overlap with different labels. To mask, mask the union of their ranges.
- A text that fails gets `{"error": "<exception class>"}`; the message is never returned or
  logged, because it can quote the text. Logs carry counts and timings only.
- A malformed request, or one that needs a model this process did not load, is refused (HTTP
  400; on Lambda, a function error).

In process: `combine.detect(text, level, gliner=..., tracer=...)`.

## Run locally

Level 0, the name rule, the combiner and both entrypoints are standard library only, so tests
need no models:

```bash
cd services/piidetector
uv run pytest           # the models are replaced by fakes; no torch, no downloads
uv run ruff check . && uv run ruff format --check .
```

Level 0 over HTTP, without models:

```bash
PII_COMPONENTS=level0 uv run python -m piidetector.http_server
curl -s localhost:8080/detect -d '{"texts": ["mail lucie.moreau@example.com"], "level": 0}'
```

Level 1 needs the models; run it from the image.

## Build

```bash
cd services/piidetector
docker buildx build --platform linux/amd64 --target http -t piidetector:http .
docker buildx build --platform linux/amd64 --target lambda -t piidetector:lambda .
# arm64 from an amd64 machine (emulated): the model export still runs natively, skip the smoke load
docker buildx build --platform linux/arm64 --target lambda --build-arg SMOKE=0 -t piidetector:lambda-arm64 .
```

- The `assets` stage downloads the pinned GLiNER and PII-Tracer revisions, exports GLiNER to
  ONNX (`scripts/build_assets.py`) and deletes the GLiNER torch weights
  (`scripts/prune_hf_cache.py`). It runs once, on the build machine's platform; both
  architectures copy its output.
- Python packages come from `uv.lock` (`uv sync --frozen`); torch is the CPU-only wheel from the
  PyTorch index on both architectures.
- At run time the images are offline: `HF_HUB_OFFLINE=1`, `TRANSFORMERS_OFFLINE=1`.
- The build downloads a few GB of weights and needs tens of GB of free disk. Lambda accepts
  images up to 10 GB uncompressed; check with `docker image ls` after a `--load` build.
- To push for Lambda, add `--provenance=false --sbom=false --push` and a registry tag: Lambda
  rejects image indexes that carry attestation manifests.

## Run as a container

```bash
docker run --rm -p 8080:8080 -e THREADS=4 piidetector:http
curl -s localhost:8080/healthz
curl -s localhost:8080/detect -d '{"texts": ["Lucie Moreau wrote. Lucie left."], "level": 1}'
```

Requests are served one at a time; scale by running more containers.

| Variable         | Meaning                                                                         |
| ---------------- | ------------------------------------------------------------------------------- |
| `PII_COMPONENTS` | what to load at start: comma list of `level0`, `gliner`, `tracer` (default all) |
| `THREADS`        | CPU threads for the models (default: the CPUs the process may use)              |
| `PII_WARMUP`     | `1` (default) runs one short synthetic sentence through each model at start     |
| `ONNX_DIR`       | the GLiNER export (default `/opt/onnx/gliner`, where the image puts it)         |
| `PORT`           | HTTP port (default 8080)                                                        |

## Deploy on AWS Lambda

Create a function from the `lambda` image (package type Image, architecture matching the
image), handler as built in, a timeout long enough for your longest text, and the environment
above. Placeholders in angle brackets:

```bash
aws lambda create-function --function-name <name> --package-type Image \
  --code ImageUri=<registry>/<repository>:<tag> --architectures arm64 \
  --role <execution-role-arn> --memory-size 7168 --timeout 900 \
  --environment 'Variables={THREADS=4}'
aws lambda invoke --function-name <name> \
  --payload '{"texts": ["Lucie Moreau wrote. Lucie left."], "level": 1}' \
  --cli-binary-format raw-in-base64-out out.json
```

The models load in the Lambda init phase, so the cold start pays for loading and invocations
do not.

### Split layout (two functions in parallel)

The benchmark's preferred layout runs Level 1 as two functions from the same image:

| function | `PII_COMPONENTS` | memory, `THREADS` |
| -------- | ---------------- | ----------------- |
| A        | `level0,gliner`  | 3584 MB, 2        |
| B        | `tracer`         | 7168 MB, 4        |

The caller sends the same texts to both at the same time, with `components` instead of `level`:

```json
{"texts": ["..."], "components": ["level0", "gliner"]}
{"texts": ["..."], "components": ["tracer"]}
```

Each answers `{"results": [{"parts": {"level0": [...], "gliner": [...]}}]}` (raw component
spans), and the caller merges them per text with `combine.combine_level1(text, {**parts_a,
**parts_b})`: steps 4 and 5 above, no model, cheap. The result equals what one function running
Level 1 returns. Each function only holds one model in memory, and the wait is the slower of the
two instead of their sum.

Level 0 alone needs no models: `PII_COMPONENTS=level0` in any image, or this directory's
`piidetector/` package zipped as a plain Python 3.12 Lambda (handler
`piidetector.lambda_handler.handler`, 128 MB is enough).

## Resources

From the benchmark's Lambda runs (approximate):

- GLiNER needs about 3.6 GB: it does not fit a 1769 or 2048 MB function. Tracer peaks at about
  4.7 GB. One function with both needs about 7.2 GB.
- Cold start (init) of a new container is about 10 s. The first invocations right after a
  function is created or updated can take minutes while Lambda caches the image; send warm-up
  calls before real traffic.
- 2 threads is the cheapest setting for GLiNER and 4 for Tracer; more threads lower latency for a
  little more cost.
- Tracer in bf16 was tried and rejected: slower on Lambda CPUs and not span-identical to fp32.
  The image runs fp32 only.

## Models and licences

| model                                                                             | revision   | licence    | runtime                                                                            |
| --------------------------------------------------------------------------------- | ---------- | ---------- | ---------------------------------------------------------------------------------- |
| [urchade/gliner_multi_pii-v1](https://huggingface.co/urchade/gliner_multi_pii-v1) | `1fcf13e8` | Apache-2.0 | ONNX fp32, exported at build                                                       |
| [perplexity-ai/PII-Tracer](https://huggingface.co/perplexity-ai/PII-Tracer)       | `d25c16f2` | MIT        | torch CPU fp32, ships its own model code (`trust_remote_code`), pinned by revision |

The weights are downloaded at image build time and are not part of this repository.
