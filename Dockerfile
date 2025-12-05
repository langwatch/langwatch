FROM node:20-alpine
RUN apk --no-cache add curl python3 make gcc g++ openssl bash
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY langwatch/package.json ./langwatch/
RUN pnpm install --frozen-lockfile --filter langwatch
COPY langwatch ./langwatch
RUN pnpm --filter langwatch run build
EXPOSE 5560

ENV NODE_ENV=production

# Set bash as the default shell
SHELL ["/bin/bash", "-c"]

CMD pnpm --filter langwatch start