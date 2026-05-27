FROM ubuntu:24.04

RUN apt-get update && apt-get install -y \
    curl git ca-certificates unzip build-essential python3 \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install opencode as root (its installer drops files in $HOME), then copy the
# binary to /usr/local/bin so the non-root agent user can execute it without
# needing access to /root.
RUN curl -fsSL https://opencode.ai/install | bash && \
    find /root -name opencode -type f 2>/dev/null | head -1 | xargs -I{} cp {} /usr/local/bin/opencode && \
    chmod +x /usr/local/bin/opencode

# Install locally-built CLI (v0.29.0) and MCP server (v0.9.0) from main branch.
# Build the tarballs first:
#   cd typescript-sdk && pnpm pack --pack-destination /path/to/build-context/
#   cd mcp-server   && pnpm pack --pack-destination /path/to/build-context/
# Then copy them into this directory before running `docker build`.
COPY langwatch-0.29.0.tgz /tmp/langwatch.tgz
COPY langwatch-mcp-server-0.9.0.tgz /tmp/langwatch-mcp-server.tgz
RUN npm install -g /tmp/langwatch.tgz && \
    npm install -g /tmp/langwatch-mcp-server.tgz

COPY entrypoint.sh /entrypoint.sh
COPY server.js /server.js
COPY manager.js /manager.js
RUN chmod +x /entrypoint.sh

# Non-root user so the pod can run with runAsNonRoot: true + readOnlyRootFilesystem.
# /workspace is owned by the agent user because the entrypoint creates skills/
# and per-session directories there at runtime.
RUN userdel -r ubuntu 2>/dev/null || true && \
    useradd -m -u 1000 -s /bin/bash agent && \
    mkdir -p /workspace && \
    chown -R agent:agent /workspace

ENV HOME=/home/agent
USER agent
WORKDIR /workspace
EXPOSE 8080
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "/server.js"]
