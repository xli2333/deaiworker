FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY requirements.txt ./

RUN npm ci
RUN pip3 install --no-cache-dir -r requirements.txt

COPY . .

RUN npm run build
RUN mkdir -p /app/outputs/tasks

ENV PORT=10000
ENV BACKEND_HOST=0.0.0.0
ENV DEAI_OUTPUT_ROOT=/app/outputs/tasks

EXPOSE 10000

CMD ["npm", "start"]
