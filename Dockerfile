FROM node:22-alpine
WORKDIR /app
COPY . .
ENV PORT=2345 DATA_FILE=/data/data.json
VOLUME /data
EXPOSE 2345
CMD ["node","server.js"]
