"""Retrain the risk model:  python -m app.risk.train"""
import json

from .model import train

if __name__ == "__main__":
    print(json.dumps(train(), indent=2))
