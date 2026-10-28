# Self-hosted server with every native tool BADPDF needs. Build: docker build -t badpdf .
FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-writer libreoffice-calc libreoffice-impress qpdf ghostscript poppler-utils tesseract-ocr fonts-dejavu \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server/package.json server/
RUN cd server && npm install --omit=dev
COPY server server
ENV NODE_ENV=production PORT=5000
USER node
EXPOSE 5000
CMD ["node", "server/src/server.js"]
