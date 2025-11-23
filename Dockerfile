# Bob Bot - Dockerfile for deployment

FROM denoland/deno:1.40.0

WORKDIR /app

# Copy source files
COPY . .

# Create data directory for learning persistence
RUN mkdir -p /app/data

# Set permissions
RUN chown -R deno:deno /app

# Switch to deno user
USER deno

# Cache dependencies
RUN deno cache src/main.ts

# Run bot
CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read", "--allow-write", "src/main.ts"]
