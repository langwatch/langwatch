# syntax=docker/dockerfile:1.7
#
# PII detector images, for linux/amd64 and linux/arm64. Build context: this directory.
#
#   docker buildx build --platform linux/amd64 --target http   -t piidetector:http .
#   docker buildx build --platform linux/arm64 --target lambda -t piidetector:lambda --build-arg SMOKE=0 .
#
# Targets:
#   http    plain container: python -m piidetector.http_server on port 8080
#   lambda  AWS Lambda container image: handler piidetector.lambda_handler.handler
#
# The models are downloaded and GLiNER is exported to ONNX once, in the "assets" stage, which
# always runs on the build machine's own platform: the ONNX graph and the Hugging Face files do
# not depend on the CPU architecture, so an arm64 image built on an amd64 machine reuses them
# instead of running the export under emulation. At run time the images never reach the network
# for models (HF_HUB_OFFLINE, TRANSFORMERS_OFFLINE).
#
# SMOKE=1 (default) loads every model once at the end of the build, offline, to prove the image
# is self-contained. Pass SMOKE=0 when building a platform the build machine has to emulate.

ARG PYTHON_IMAGE=python:3.12-slim-bookworm
ARG LAMBDA_IMAGE=public.ecr.aws/lambda/python:3.12
ARG UV_IMAGE=ghcr.io/astral-sh/uv:0.12.17

# uv for the target platform (final stages) and for the build machine (assets stage).
FROM ${UV_IMAGE} AS uv
FROM --platform=$BUILDPLATFORM ${UV_IMAGE} AS uv-build

# ---------------------------------------------------------------- models, baked once
FROM --platform=$BUILDPLATFORM ${PYTHON_IMAGE} AS assets
COPY --from=uv-build /uv /bin/uv
ENV HF_HOME=/opt/hf \
    HF_HUB_DISABLE_TELEMETRY=1 \
    UV_PROJECT_ENVIRONMENT=/opt/build-venv \
    UV_PYTHON_DOWNLOADS=never \
    UV_LINK_MODE=copy \
    PYTHONDONTWRITEBYTECODE=1
WORKDIR /src
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-dev --no-install-project --extra models --extra export
COPY piidetector ./piidetector
COPY scripts ./scripts
RUN PYTHONPATH=/src /opt/build-venv/bin/python scripts/build_assets.py /opt/onnx/gliner \
 && /opt/build-venv/bin/python scripts/prune_hf_cache.py /opt/hf

# Each final stage installs the locked runtime into /opt/venv against its own base image's
# Python, then copies the baked models and the service code.

# ---------------------------------------------------------------- plain HTTP container
FROM ${PYTHON_IMAGE} AS http
ARG SMOKE=1
COPY --from=uv /uv /bin/uv
ENV UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_PYTHON_DOWNLOADS=never \
    UV_LINK_MODE=copy \
    PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-dev --no-install-project --extra models \
 && rm -rf /opt/venv/lib/python3.12/site-packages/torch/include /opt/venv/lib/python3.12/site-packages/torch/test \
 && rm /bin/uv
COPY --from=assets /opt/hf /opt/hf
COPY --from=assets /opt/onnx /opt/onnx
COPY piidetector ./piidetector
ENV PATH=/opt/venv/bin:$PATH \
    PYTHONPATH=/app \
    HF_HOME=/opt/hf \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    HF_HUB_DISABLE_TELEMETRY=1 \
    HF_MODULES_CACHE=/tmp/hf_modules \
    TOKENIZERS_PARALLELISM=false \
    ONNX_DIR=/opt/onnx/gliner \
    PORT=8080
RUN if [ "$SMOKE" = "1" ]; then \
      PII_WARMUP=0 THREADS=2 python -c "from piidetector.service import Detector; Detector.from_environment()" \
      && rm -rf /tmp/hf_modules; \
    fi
RUN useradd --system --uid 10001 --no-create-home app
USER 10001
EXPOSE 8080
CMD ["python", "-m", "piidetector.http_server"]

# ---------------------------------------------------------------- AWS Lambda container image
FROM ${LAMBDA_IMAGE} AS lambda
ARG SMOKE=1
COPY --from=uv /uv /bin/uv
ENV UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_PYTHON_DOWNLOADS=never \
    UV_PYTHON=/var/lang/bin/python3.12 \
    UV_LINK_MODE=copy \
    PYTHONDONTWRITEBYTECODE=1
WORKDIR /build
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-dev --no-install-project --extra models \
 && rm -rf /opt/venv/lib/python3.12/site-packages/torch/include /opt/venv/lib/python3.12/site-packages/torch/test \
 && rm /bin/uv
COPY --from=assets /opt/hf /opt/hf
COPY --from=assets /opt/onnx /opt/onnx
COPY piidetector ${LAMBDA_TASK_ROOT}/piidetector
# The Lambda runtime starts the base image's own Python, so the locked packages join its path.
# Lambda's file system is read-only outside /tmp, hence HF_MODULES_CACHE.
ENV PYTHONPATH=/opt/venv/lib/python3.12/site-packages \
    HF_HOME=/opt/hf \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    HF_HUB_DISABLE_TELEMETRY=1 \
    HF_MODULES_CACHE=/tmp/hf_modules \
    TOKENIZERS_PARALLELISM=false \
    ONNX_DIR=/opt/onnx/gliner
WORKDIR ${LAMBDA_TASK_ROOT}
RUN if [ "$SMOKE" = "1" ]; then \
      PII_WARMUP=0 THREADS=2 python -c "import piidetector.lambda_handler" && rm -rf /tmp/hf_modules; \
    fi
CMD ["piidetector.lambda_handler.handler"]
