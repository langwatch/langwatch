FROM node:20-alpine
RUN apk --no-cache add curl python3 make gcc g++ openssl
WORKDIR /app
COPY langwatch/package.json langwatch/package-lock.json ./langwatch/
RUN npm --prefix=langwatch ci
COPY models.json .
COPY langwatch ./langwatch
RUN npm --prefix=langwatch run build
CMD npm --prefix=langwatch run start:docker
EXPOSE 3000