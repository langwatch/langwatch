FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=development
RUN mkdir langwatch docs
COPY langwatch/package.json langwatch/package-lock.json ./langwatch/
RUN npm --prefix=langwatch ci
COPY langwatch ./langwatch
COPY docs ./docs
CMD npm --prefix=langwatch run dev
EXPOSE 3000