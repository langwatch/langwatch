FROM node:22-alpine
RUN apk --no-cache add curl python3 make gcc g++ openssl bash
RUN corepack enable && corepack prepare pnpm@10.18.0 --activate
WORKDIR /app/langwatch
COPY langwatch/package.json langwatch/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY langwatch/. .
RUN pnpm build
EXPOSE 5560

ENV NODE_ENV=production

# Set bash as the default shell
SHELL ["/bin/bash", "-c"]

CMD pnpm start
