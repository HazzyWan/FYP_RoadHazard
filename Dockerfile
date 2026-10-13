FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libgl1 \
    libsm6 \
    libxext6 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY webapp/requirements.txt /app/webapp/requirements.txt
RUN pip install -r /app/webapp/requirements.txt

COPY webapp /app/webapp
COPY runs /app/runs

WORKDIR /app/webapp

ENV PORT=8080 \
    MODEL_PATH=/app/runs/detect/road_hazards_multi6/weights/best.pt \
    USE_SSL=false \
    FLASK_DEBUG=0

CMD ["gunicorn", "-w", "1", "-k", "gthread", "--threads", "8", "-b", "0.0.0.0:8080", "app:app"]
