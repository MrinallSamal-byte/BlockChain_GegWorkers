FROM node:22-alpine AS builder
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY contracts/package.json ./contracts/package.json
COPY circuits/package.json ./circuits/package.json
COPY validator/package.json ./validator/package.json
COPY sdk/react-native/package.json ./sdk/react-native/package.json
COPY sdk/shared/package.json ./sdk/shared/package.json
RUN pnpm install --filter @vgdp/validator... --frozen-lockfile --prod=false
COPY . .
RUN pnpm --filter @vgdp/validator run build

FROM node:22-alpine AS runner
WORKDIR /app/validator
ENV NODE_ENV=production
COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/validator/node_modules ./node_modules
COPY --from=builder /app/validator/dist ./dist
COPY --from=builder /app/validator/package.json .
EXPOSE 8080
CMD ["node", "dist/server.js"]
