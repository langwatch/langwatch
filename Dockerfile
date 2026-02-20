FROM node:24-alpine
RUN apk --no-cache add curl python3 make gcc g++ openssl bash
RUN npm install -g pnpm@10.24.0

# Install Goose migration tool with SHA256 verification
ARG GOOSE_SHA256_ARM64=dfafe0254b0058cabf016234a500df5ada1623ed034e9473cee9fe4ed07ca090
ARG GOOSE_SHA256_X86_64=8b3eee9845cd87d827ba1abddb85235fb3684f9fb1666426f647ddd12fd29efe
RUN ARCH=$(uname -m) && \
  if [ "$ARCH" = "aarch64" ]; then \
  GOOSE_URL="https://github.com/pressly/goose/releases/download/v3.26.0/goose_linux_arm64"; \
  GOOSE_SHA256="$GOOSE_SHA256_ARM64"; \
  elif [ "$ARCH" = "x86_64" ]; then \
  GOOSE_URL="https://github.com/pressly/goose/releases/download/v3.26.0/goose_linux_x86_64"; \
  GOOSE_SHA256="$GOOSE_SHA256_X86_64"; \
  else \
  echo "Unsupported architecture: $ARCH" && exit 1; \
  fi && \
  curl -fsSL "$GOOSE_URL" -o /tmp/goose && \
  echo "$GOOSE_SHA256  /tmp/goose" | sha256sum -c - || (rm -f /tmp/goose && exit 1) && \
  mv /tmp/goose /usr/local/bin/goose && \
  chmod +x /usr/local/bin/goose

WORKDIR /app

# Skip Prisma checksum verification for air-gapped builds
ENV PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1

COPY langwatch/package.json langwatch/pnpm-lock.yaml langwatch/pnpm-workspace.yaml ./langwatch/
COPY langwatch/vendor ./langwatch/vendor
# https://stackoverflow.com/questions/70154568/pnpm-equivalent-command-for-npm-ci
RUN cd langwatch && CI=true pnpm install --frozen-lockfile
COPY langevals/ts-integration/evaluators.generated.ts ./langevals/ts-integration/evaluators.generated.ts
COPY langwatch ./langwatch
RUN cd langwatch && pnpm run build
EXPOSE 5560

ENV NODE_ENV=production

# Set bash as the default shell
SHELL ["/bin/bash", "-c"]

CMD cd langwatch && pnpm start
