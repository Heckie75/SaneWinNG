FROM mcr.microsoft.com/devcontainers/javascript-node:1-22-bookworm

RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get install -y --no-install-recommends sane-utils libsane1 tesseract-ocr tesseract-ocr-eng tesseract-ocr-deu avahi-utils libnss3 libgtk-3-0 libgbm1 libasound2 libxss1 libxtst6 libxkbcommon0 libxshmfence1 \
    && rm -rf /var/lib/apt/lists/*