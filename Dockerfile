FROM mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27 AS build
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json tsconfig.json eslint.config.js ./
RUN npm ci --include=dev --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force
COPY src ./src
RUN npm run build \
    && npm prune --omit=dev --omit=optional --ignore-scripts \
    && npm cache clean --force

FROM mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27
WORKDIR /app
USER root
RUN apt-get purge -y --auto-remove gstreamer1.0-plugins-bad libgstreamer-plugins-bad1.0-0 \
    && rm -rf /var/lib/apt/lists/* /usr/lib/node_modules/npm /usr/lib/node_modules/yarn \
      /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/yarn \
      /usr/bin/npm /usr/bin/npx /usr/bin/yarn /usr/bin/yarnpkg
COPY --from=build --chown=pwuser:pwuser /app/package.json /app/package-lock.json ./
COPY --from=build --chown=pwuser:pwuser /app/node_modules ./node_modules
COPY --from=build --chown=pwuser:pwuser /app/dist ./dist
COPY --chown=pwuser:pwuser migrations ./migrations
COPY --chown=pwuser:pwuser openapi ./openapi
RUN mkdir -p /app/storage && chown -R pwuser:pwuser /app/storage
ENV NODE_ENV=production \
    NODE_OPTIONS=--enable-source-maps \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
USER pwuser
EXPOSE 3000
CMD ["node", "dist/main.js"]
