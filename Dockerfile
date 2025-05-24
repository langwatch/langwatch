FROM node:20-alpine
RUN apk --no-cache add curl python3 make gcc g++ openssl bash
WORKDIR /app
COPY langwatch/package.json langwatch/package-lock.json ./langwatch/
RUN npm --prefix=langwatch ci
COPY langwatch ./langwatch
RUN npm --prefix=langwatch run build
EXPOSE 5560

ENV NODE_ENV=production

# Set bash as the default shell
SHELL ["/bin/bash", "-c"]

CMD npm --prefix=langwatch start