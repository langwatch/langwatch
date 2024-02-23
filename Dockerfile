FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=development
RUN mkdir langwatch docs
COPY langwatch ./langwatch
COPY docs ./docs
RUN npm --prefix=langwatch ci
CMD npm --prefix=langwatch run prisma:db:push && npm --prefix=langwatch run elastic:index:create && npm --prefix=langwatch run dev
EXPOSE 3000