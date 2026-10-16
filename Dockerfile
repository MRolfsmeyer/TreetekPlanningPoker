# Treetek Planning Poker – Container für Server und Cloud
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js ./
COPY public ./public
COPY vendor ./vendor
ENV NODE_ENV=production \
    PORT=3000 \
    NO_BROWSER=1 \
    DATA_FILE=/data/planning-poker-daten.json
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
EXPOSE 3000
USER node
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "server.js"]
