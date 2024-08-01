FROM node:20-alpine
RUN apk --no-cache add curl
WORKDIR /app
RUN mkdir langwatch docs
COPY package.json package-lock.json .
RUN npm ci
COPY langwatch/langwatch/package.json langwatch/langwatch/package-lock.json langwatch/langwatch/
RUN cd langwatch/langwatch && npm ci && cd -
COPY langwatch/ langwatch/
COPY prisma/ prisma/
RUN npm run start:prepare
COPY . .
RUN cp langwatch/langwatch/.env.example .env
ARG SENTRY_AUTH_TOKEN
ENV TMP_SENTRY_AUTH_TOKEN=$SENTRY_AUTH_TOKEN
RUN echo "TMP_SENTRY_AUTH_TOKEN:"
RUN echo $$TMP_SENTRY_AUTH_TOKEN
RUN echo "==="
RUN if [ ! -z "$$TMP_SENTRY_AUTH_TOKEN" ]; then export SENTRY_AUTH_TOKEN=$$TMP_SENTRY_AUTH_TOKEN; fi
RUN npm run build
RUN rm .env
ENV NODE_ENV=production

EXPOSE 3000

CMD npm start
