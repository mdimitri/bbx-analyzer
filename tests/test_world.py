"""The splash screen's toy world: 100 distinct object kinds, all placed, deterministic, and flights that never hit anything,
at a believable speed, with a stable rate loop."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node not installed")


def test_world_and_flights():
    out = subprocess.run(["node", str(Path(__file__).parent / "world_harness.js")], capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr[-800:]
    r = json.loads(out.stdout.strip().splitlines()[-1])
    assert r["kinds"] == 100 and r["unique"] == 100
    assert r["used"] == 100 and r["minCount"] >= 2
    assert r["same"]
    a = r["ag"]                                              # traffic and people: plenty of them, finite poses, cars on roads, walkers on the pavement
    assert a["n"] >= 100 and a["bad"] == 0 and a["walkers"] > 0 and a["bikes"] > 0
    assert a["carsOnRoad"] / a["cars"] > 0.97 and a["walkersOffRoad"] / a["walkers"] > 0.97
    for f in r["flights"]:
        assert f["hits"] == 0 and f["finite"] and f["tricks"] > 0
        assert 12 < f["speed"] < 30                          # a believable freestyle pace, not a crawl
        assert f["hasPid"] and f["trackRatio"] < 0.8         # the rate loop follows its setpoint (stable, not ringing)
        assert 0 <= f["motMin"] and f["motMax"] <= 100
    c = r["chain"]                                            # the endless flight: no jump at a hand-over, same history, no collisions
    assert c["gap"] < 0.01 and c["hist"] < 1e-3 and c["hits"] == 0 and c["sticks"]
