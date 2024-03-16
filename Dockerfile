FROM node:20-alpine
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
RUN npm run build
ENV NODE_ENV=production
CMD npm start
EXPOSE 3000
