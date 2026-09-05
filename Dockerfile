FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY tsconfig.json .
COPY src/ src/
RUN bun run check

FROM oven/bun:1-slim
WORKDIR /app
COPY --from=build /app/package.json /app/bun.lock ./
RUN bun install --production --frozen-lockfile
COPY --from=build /app/src/ ./src/
USER bun
CMD ["bun", "run", "src/index.ts"]
