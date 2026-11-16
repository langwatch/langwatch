ARG CLICKHOUSE_VERSION=26.8.36.3
# The multi-platform index digest of that tag (linux/amd64 and linux/arm64), so
# a retagged upstream image cannot change what the build ships. Bump it with the
# version: `docker buildx imagetools inspect clickhouse/clickhouse-server:<version>`.
ARG CLICKHOUSE_DIGEST=sha256:d426d2f612e1e189c90f9a3f8dcd85a03c6851273833817a296bb327e63aa7a7

# Stage 1: Build Go config generator
FROM golang:1.27.4-alpine AS builder
WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ cmd/
COPY internal/ internal/
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /ch-config ./cmd/ch-config

# Stage 2: ClickHouse image
FROM clickhouse/clickhouse-server:${CLICKHOUSE_VERSION}@${CLICKHOUSE_DIGEST}

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        tini \
        curl \
    && rm -rf /var/lib/apt/lists/*

# Copy Go config generator
COPY --from=builder /ch-config /usr/local/bin/ch-config

# The server's own setting and privilege names, so ch-config refuses an access
# file ClickHouse would reject (a bad name stops every users config reload).
RUN install -d /usr/share/ch-config \
    && clickhouse local --query "SELECT name, type FROM system.settings FORMAT TSV" > /usr/share/ch-config/settings.tsv \
    && clickhouse local --query "SELECT privilege FROM system.privileges FORMAT TSV" > /usr/share/ch-config/privileges.tsv

# Copy scripts
COPY scripts/ /scripts/
RUN chmod +x /scripts/*.sh

# Ensure all runtime dirs are owned by clickhouse (uid 101) at build time.
# No chown at runtime — the entrypoint runs as uid 101 and writes directly.
RUN install -d -o clickhouse -g clickhouse -m 755 \
        /etc/clickhouse-server/config.d \
        /etc/clickhouse-server/users.d \
        /scripts \
    && install -d -o clickhouse -g clickhouse -m 750 /run/clickhouse-access \
    && chown clickhouse:clickhouse /scripts/*.sh

# Group 101 too: secret mounts may be readable by the clickhouse group only (0440).
USER 101:101
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8123/ping || exit 1
ENTRYPOINT ["/usr/bin/tini", "--", "/scripts/entrypoint-wrapper.sh"]
CMD ["clickhouse-server"]
