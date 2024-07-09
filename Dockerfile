FROM node:20-alpine
RUN apk --no-cache add curl
WORKDIR /app
COPY langwatch/package.json langwatch/package-lock.json ./langwatch/
RUN npm --prefix=langwatch ci
COPY models.json .
COPY langwatch ./langwatch
RUN cp ./langwatch/.env.example ./langwatch/.env
RUN npm --prefix=langwatch run start:prepare:files
RUN rm langwatch/.env
CMD npm --prefix=langwatch run dev
EXPOSE 3000