FROM node:20-alpine
RUN apk --no-cache add curl python3 make gcc g++ openssl bash
RUN npm install -g pnpm@10.24.0
WORKDIR /app
COPY langwatch/package.json langwatch/pnpm-lock.yaml langwatch/pnpm-workspace.yaml ./langwatch/
# https://stackoverflow.com/questions/70154568/pnpm-equivalent-command-for-npm-ci
RUN cd langwatch && CI=true pnpm install --frozen-lockfile
COPY langwatch ./langwatch
RUN cd langwatch && pnpm run build
EXPOSE 5560

ENV NODE_ENV=production

# Set bash as the default shell
SHELL ["/bin/bash", "-c"]

CMD cd langwatch && pnpm start