FROM node:20-slim

# Install ffmpeg, python3, pip, yt-dlp, and libvips for sharp
RUN apt-get update && \
    apt-get install -y ffmpeg python3 python3-pip curl libvips-dev && \
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

# Install IOPaint for AI watermark removal (LaMa model)
RUN pip install --break-system-packages iopaint torch torchvision --extra-index-url https://download.pytorch.org/whl/cpu

WORKDIR /app

# Copy package files
COPY server/package*.json ./server/
COPY client/package*.json ./client/

# Install dependencies
RUN cd server && npm install
RUN cd client && npm install

# Copy source code
COPY server ./server
COPY client ./client

# Build frontend
RUN cd client && npm run build

# Pre-download the LaMa model
RUN python3 -c "from iopaint.download import cli_download_model; cli_download_model('lama')" || true

# Create startup script that launches IOPaint + Node.js
RUN echo '#!/bin/bash\n\
python3 -m iopaint start --model=lama --device=cpu --port=8090 &\n\
sleep 5\n\
cd /app/server && npm start' > /app/start.sh && chmod +x /app/start.sh

# Start both services
WORKDIR /app/server
EXPOSE 3001
CMD ["/bin/bash", "/app/start.sh"]
