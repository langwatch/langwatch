# syntax=docker/dockerfile:1.7

FROM golang:1.26.1-alpine AS build
WORKDIR /src
RUN apk add --no-cache git ca-certificates tzdata

# Pre-copy go.mod/go.sum for layer caching.
COPY go.mod go.sum ./
RUN go mod download

COPY . .
ARG VERSION=dev
RUN --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux go build \
      -ldflags="-s -w -X main.Version=${VERSION}" \
      -trimpath \
      -o /out/gateway ./cmd/gateway

FROM gcr.io/distroless/static-debian12:nonroot AS runtime
USER nonroot:nonroot
COPY --from=build /out/gateway /gateway
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /usr/share/zoneinfo /usr/share/zoneinfo
EXPOSE 5563
ENTRYPOINT ["/gateway"]
