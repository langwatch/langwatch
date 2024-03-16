FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=development
RUN mkdir langwatch docs
COPY package.json package-lock.json .
RUN npm ci
COPY langwatch/langwatch/package.json langwatch/langwatch/package-lock.json langwatch/langwatch/
RUN npm --prefix langwatch/langwatch ci
COPY langwatch/ langwatch/
COPY prisma/ prisma/
ARG DATABASE_URL
RUN DATABASE_URL=$DATABASE_URL npm run start:prepare
RUN npm run build
CMD npm start
EXPOSE 3000
