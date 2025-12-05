FROM node:20-alpine
RUN apk --no-cache add curl python3 make gcc g++ openssl bash
WORKDIR /app
COPY langwatch/package.json langwatch/package-lock.json ./langwatch/
# https://stackoverflow.com/questions/70154568/pnpm-equivalent-command-for-npm-ci
RUN CI=true pnpm --prefix=langwatch install --frozen-lockfile
COPY langwatch ./langwatch
RUN pnpm --prefix=langwatch run build
EXPOSE 5560

ENV NODE_ENV=production

# Set bash as the default shell
SHELL ["/bin/bash", "-c"]

CMD pnpm --prefix=langwatch start