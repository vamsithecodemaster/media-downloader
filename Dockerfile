FROM node:20-slim

# Install ffmpeg, python3, and yt-dlp
RUN apt-get update && \
    apt-get install -y ffmpeg python3 curl && \
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

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

# Start server
WORKDIR /app/server
EXPOSE 3001
CMD ["npm", "start"]
