FROM ubuntu:24.04

RUN apt-get update && apt-get install -y \
    curl git ca-certificates unzip build-essential python3 \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

 RUN curl -fsSL https://opencode.ai/install | bash && \
      find /root -name opencode -type f 2>/dev/null | head -1 | xargs -I{} cp {} /usr/local/bin/opencode && \
      chmod +x /usr/local/bin/opencode
ENV PATH="/root/.local/bin:$PATH"

# Install locally-built CLI (v0.29.0) and MCP server (v0.9.0) from main branch.
# Build the tarballs first:
#   cd typescript-sdk && pnpm pack --pack-destination /path/to/build-context/
#   cd mcp-server   && pnpm pack --pack-destination /path/to/build-context/
# Then copy them into this directory before running `docker build`.
COPY langwatch-0.29.0.tgz /tmp/langwatch.tgz
COPY langwatch-mcp-server-0.9.0.tgz /tmp/langwatch-mcp-server.tgz
RUN npm install -g /tmp/langwatch.tgz
RUN npm install -g /tmp/langwatch-mcp-server.tgz

COPY entrypoint.sh /entrypoint.sh
COPY server.js /server.js
RUN chmod +x /entrypoint.sh

WORKDIR /workspace
EXPOSE 8080
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "/server.js"]
