ARG CLICKHOUSE_VERSION=25.10.2.65

# Stage 1: Build Go config generator
FROM golang:1.26-alpine AS builder
WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ cmd/
COPY internal/ internal/
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /ch-config ./cmd/ch-config

# Stage 2: ClickHouse image
FROM clickhouse/clickhouse-server:${CLICKHOUSE_VERSION}

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        tini \
        curl \
    && rm -rf /var/lib/apt/lists/*

# Copy Go config generator
COPY --from=builder /ch-config /usr/local/bin/ch-config

# Copy scripts
COPY scripts/ /scripts/
RUN chmod +x /scripts/*.sh

# Ensure all runtime dirs are owned by clickhouse (uid 101) at build time.
# No chown at runtime — the entrypoint runs as uid 101 and writes directly.
RUN install -d -o clickhouse -g clickhouse -m 755 \
        /etc/clickhouse-server/config.d \
        /etc/clickhouse-server/users.d \
        /scripts \
    && chown clickhouse:clickhouse /scripts/*.sh

USER 101
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8123/ping || exit 1
ENTRYPOINT ["/usr/bin/tini", "--", "/scripts/entrypoint-wrapper.sh"]
CMD ["clickhouse-server"]
