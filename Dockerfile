FROM node:20-alpine
RUN apk --no-cache add curl python3 make gcc g++ socat openssl
WORKDIR /app
RUN mkdir langwatch docs
COPY package.json package-lock.json .
RUN npm ci
COPY langwatch/langwatch/package.json langwatch/langwatch/package-lock.json langwatch/langwatch/
RUN cd langwatch/langwatch && npm ci && cd -
COPY langwatch/ langwatch/
COPY prisma/ prisma/
COPY . .

# Upload sourcemaps to Sentry
ARG SENTRY_AUTH_TOKEN

RUN rm .env &>/dev/null || true
RUN npm run build
ENV NODE_ENV=production

EXPOSE 5560
EXPOSE 5432
EXPOSE 6379

CMD /app/scripts/start-proxy.sh & npm start

