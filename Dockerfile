FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip python3-venv fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

ENV VIRTUAL_ENV=/opt/venv
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

COPY package*.json ./
COPY requirements.txt ./

RUN python3 -m venv "$VIRTUAL_ENV"
RUN npm ci
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

COPY . .

RUN npm run build
RUN mkdir -p /app/outputs/tasks

ENV PORT=10000
ENV BACKEND_HOST=0.0.0.0
ENV DEAI_OUTPUT_ROOT=/app/outputs/tasks

EXPOSE 10000

CMD ["npm", "start"]
