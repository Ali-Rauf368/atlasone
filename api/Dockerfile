FROM node:22-alpine AS build
# Prisma's query engine links against OpenSSL
RUN apk add --no-cache openssl
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc && npm prune --omit=dev

FROM node:22-alpine
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json ./
USER node
EXPOSE 4000
# Use the pinned local Prisma CLI (a production dependency); never let npx fetch a different major version
CMD ["sh", "-c", "./node_modules/.bin/prisma db push --skip-generate && exec node --import ./dist/lib/tracing.js dist/index.js"]
