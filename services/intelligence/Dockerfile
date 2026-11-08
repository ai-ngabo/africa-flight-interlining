FROM python:3.12-slim
WORKDIR /srv/intelligence
COPY services/intelligence/requirements.txt services/intelligence/requirements-rag.txt ./
RUN pip install --no-cache-dir -r requirements.txt -r requirements-rag.txt
COPY services/intelligence/ ./
COPY data /srv/data
ENV DATA_DIR=/srv/data
RUN python -m app.risk.train
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
