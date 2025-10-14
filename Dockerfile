FROM node:22-alpine

ARG PNPM_VERSION=10.18.0

# System dependencies
RUN apk --no-cache add curl python3 make gcc g++ openssl bash

# Enable pnpm via corepack with version arg
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

WORKDIR /app/langwatch

# Copy manifests for better layer caching
COPY langwatch/package.json langwatch/pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY langwatch/. .

# Build
RUN pnpm build

EXPOSE 5560
ENV NODE_ENV=production

# Set bash as the default shell
SHELL ["/bin/bash", "-c"]

CMD cd langwatch && pnpm start
