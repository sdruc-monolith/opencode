# syntax=docker/dockerfile:1.7

ARG BUN_VERSION=1.3.13

FROM oven/bun:${BUN_VERSION}-alpine AS build
WORKDIR /workspace

# Native deps used by some transitive packages during install/build.
RUN apk add --no-cache python3 make g++

COPY . .

RUN bun install --frozen-lockfile
RUN bun run --cwd packages/opencode script/build.ts --single --skip-embed-web-ui
RUN cp packages/opencode/dist/opencode-linux-*/bin/opencode /tmp/opencode

FROM alpine:3.21 AS runtime

RUN apk add --no-cache libgcc libstdc++ ripgrep git

RUN addgroup -S opencode && adduser -S -G opencode opencode

COPY --from=build /tmp/opencode /usr/local/bin/opencode

USER opencode
WORKDIR /home/opencode

ENTRYPOINT ["/usr/local/bin/opencode"]
CMD ["--help"]
