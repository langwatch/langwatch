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
# RUN npm run build
ENV NODE_ENV=production

EXPOSE 3000

CMD npm start
