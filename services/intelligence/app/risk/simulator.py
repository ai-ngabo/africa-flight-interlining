"""Synthetic connection-outcome simulator.

Real historical punctuality data for African airspace is not freely available as
a labelled dataset, so the MVP trains on simulated outcomes. Replace
``simulate`` with features/labels derived from real data (e.g. OpenSky Network
departures/arrivals, free for research) to make the model meaningful.
"""
from __future__ import annotations

import numpy as np

FEATURES = [
    "buffer_min",          # layover minus required connection time
    "required_min",        # MCT / self-transfer / ground-transfer requirement
    "inbound_otp",         # inbound carrier on-time performance (0-1)
    "inbound_delay_std",   # historical delay spread of the inbound service (min)
    "weather_risk",        # 1 if the hub is in its adverse-weather season
    "terminal_complexity", # 1 (simple) .. 5 (complex)
    "is_self_transfer",
    "is_ground_transfer",
    "inbound_is_bus",
    "inbound_duration_min",
]

# +1: risk increases with feature, -1: decreases, 0: unconstrained
MONOTONE = {
    "buffer_min": -1,
    "required_min": 0,
    "inbound_otp": -1,
    "inbound_delay_std": 1,
    "weather_risk": 1,
    "terminal_complexity": 1,
    "is_self_transfer": 0,
    "is_ground_transfer": 0,
    "inbound_is_bus": 0,
    "inbound_duration_min": 1,
}


def simulate(n: int, seed: int = 7) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    kind = rng.choice(3, size=n, p=[0.3, 0.55, 0.15])  # 0 protected, 1 self, 2 ground
    is_self = (kind == 1).astype(float)
    is_ground = (kind == 2).astype(float)
    inbound_bus = (rng.random(n) < 0.12).astype(float)
    required = np.where(kind == 0, rng.uniform(40, 90, n), np.where(kind == 1, rng.uniform(100, 210, n), rng.uniform(90, 240, n)))
    buffer = np.minimum(rng.exponential(110, n), 900)
    otp = rng.uniform(0.55, 0.95, n)
    delay_std = 12 + (1 - otp) * 110 + inbound_bus * 15 + rng.normal(0, 4, n)
    weather = (rng.random(n) < 0.3).astype(float)
    complexity = rng.integers(1, 6, n).astype(float)
    duration = np.where(inbound_bus == 1, rng.uniform(180, 720, n), rng.uniform(40, 480, n))

    # Inbound delay
    on_time_p = otp * np.where(weather == 1, 0.88, 1.0)
    delayed = rng.random(n) > on_time_p
    delay = np.where(
        delayed,
        rng.exponential(delay_std * 1.3 * np.where(weather == 1, 1.3, 1.0)) + duration * 0.02,
        np.maximum(0, rng.normal(0, 5, n)),
    )

    # Time actually needed to make the connection
    spread = 0.10 + 0.04 * complexity
    factor = np.where(kind == 0, rng.normal(0.70, 0.15, n), np.where(kind == 1, rng.normal(0.80, spread), rng.normal(0.85, 0.15, n) * np.where(weather == 1, 1.15, 1.0)))
    needed = required * np.clip(factor, 0.4, None)

    layover = required + buffer
    missed = (delay + needed > layover).astype(int)

    X = np.column_stack([buffer, required, otp, delay_std, weather, complexity, is_self, is_ground, inbound_bus, duration])
    return X, missed
